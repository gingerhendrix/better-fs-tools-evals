"""Harbor agent that runs the Better FS Tools eval loop against the task container.

Harbor builds or pulls the task image, starts the container, and calls run().
run() finds the container, then starts `src/harbor/agent.ts` with Bun on the
host. That script drives the model and runs every tool call in the container
through `docker exec`. After it exits, Harbor collects artifacts and runs the
task verifier as usual.

Use it with the Docker environment only:

    PYTHONPATH=apps/eval-harness/harbor harbor run -p <task> \\
        --agent-import-path bft_agent:BftAgent -m deepseek/deepseek-v4.1-flash

Set BFT_TOOLS to one of the tool sets in `src/harbor/bundle.ts` (default,
bash, bash-read-edit, bash-read-patch) to change the tools the model gets.
"""

import asyncio
import json
import os
import re
from pathlib import Path

from harbor.agents.base import BaseAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

APP_DIR = Path(__file__).resolve().parent.parent
AGENT_SCRIPT = APP_DIR / "src" / "harbor" / "agent.ts"


def compose_project(session_id: str) -> str:
    """Same rule as Harbor's Docker environment uses for the project name."""
    name = session_id.lower()
    if not re.match(r"^[a-z0-9]", name):
        name = "0" + name
    return re.sub(r"[^a-z0-9_-]", "-", name)


class BftAgent(BaseAgent):
    @staticmethod
    def name() -> str:
        return "better-fs-tools"

    def version(self) -> str:
        return "0.1.0"

    async def setup(self, environment: BaseEnvironment) -> None:
        return None

    async def _container_id(self, environment: BaseEnvironment) -> str:
        project = compose_project(environment.session_id)
        proc = await asyncio.create_subprocess_exec(
            "docker", "ps", "-q",
            "--filter", f"label=com.docker.compose.project={project}",
            "--filter", "label=com.docker.compose.service=main",
            stdout=asyncio.subprocess.PIPE,
        )
        out, _ = await proc.communicate()
        ids = out.decode().split()
        if len(ids) != 1:
            raise RuntimeError(f"expected one main container for {project}, found {ids}")
        return ids[0]

    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        container = await self._container_id(environment)
        pwd = await environment.exec("pwd")
        workdir = (pwd.stdout or "/").strip() or "/"

        logs_dir = self.logs_dir.resolve()
        logs_dir.mkdir(parents=True, exist_ok=True)
        instruction_file = logs_dir / "instruction.md"
        instruction_file.write_text(instruction)

        args = [
            "bun", "run", str(AGENT_SCRIPT),
            "--container", container,
            "--workdir", workdir,
            "--instruction", str(instruction_file),
            "--out", str(logs_dir),
            "--model", self.model_name or "deepseek/deepseek-v4.1-flash",
        ]
        if environment.default_user is not None:
            args += ["--user", str(environment.default_user)]
        max_steps = os.environ.get("BFT_MAX_STEPS")
        if max_steps:
            args += ["--max-steps", max_steps]
        tool_set = os.environ.get("BFT_TOOLS")
        if tool_set:
            args += ["--tools", tool_set]
        step_timeout = os.environ.get("BFT_STEP_TIMEOUT")
        if step_timeout:
            args += ["--step-timeout", step_timeout]

        with open(logs_dir / "agent-stdout.log", "wb") as log:
            proc = await asyncio.create_subprocess_exec(
                *args, cwd=APP_DIR, stdout=log, stderr=asyncio.subprocess.STDOUT
            )
            try:
                await proc.wait()
            except asyncio.CancelledError:
                proc.kill()
                await proc.wait()
                raise
            finally:
                self._fill_context(context)

    def _fill_context(self, context: AgentContext) -> None:
        result_file = self.logs_dir.resolve() / "result.json"
        if not result_file.exists():
            return
        result = json.loads(result_file.read_text())
        metrics = result["metrics"]
        context.n_input_tokens = metrics["inputTokens"]
        context.n_cache_tokens = metrics["cachedInputTokens"]
        context.n_output_tokens = metrics["outputTokens"]
        context.cost_usd = result.get("costUsd")
        context.metadata = {
            "end": result["end"],
            "toolSet": result.get("toolSet", "default"),
            "loopError": result["loopError"],
            "steps": metrics["steps"],
            "toolCalls": metrics["toolCalls"],
            "toolErrors": metrics["toolErrors"],
            "wallMs": result["wallMs"],
        }
