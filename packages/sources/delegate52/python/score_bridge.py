"""Score one DELEGATE-52 backward step with the upstream domain scorer.

Reads one JSON object on stdin:

    {"repo": "<DELEGATE52 checkout>", "domain": "docker" | "json",
     "sampleId": "docker1", "startState": "basic_state",
     "seedFiles": {"Dockerfile": "..."}, "files": {"Dockerfile": "..."}}

Writes one JSON object on stdout:

    {"score": 0.93 | null, "error": null | "gen_parse_error", "details": {...},
     "scorerOutput": "<what the scorer printed>"}

It loads only `domains/domain_base.py` and the one domain module, with a stub
`domains` package. The real `domains/__init__.py` imports all 52 domains and
their heavy dependencies. Only the docker and json domains are allowed: the
python domain runs model code inside the scorer.

The scorers print to stdout, so the bridge captures stdout while they run.
"""

import contextlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import types

DOMAINS = {"docker": ("domain_docker", "DomainDocker"), "json": ("domain_json", "DomainJSON")}


def load_module(repo, name):
    path = os.path.join(repo, "domains", f"{name}.py")
    spec = importlib.util.spec_from_file_location(f"domains.{name}", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_domain(repo, domain):
    if domain not in DOMAINS:
        raise ValueError(f"domain {domain!r} is not allowed; the bridge scores {sorted(DOMAINS)}")
    module_name, class_name = DOMAINS[domain]
    sys.path.insert(0, repo)
    package = types.ModuleType("domains")
    package.__path__ = [os.path.join(repo, "domains")]
    sys.modules["domains"] = package
    load_module(repo, "domain_base")
    return getattr(load_module(repo, module_name), class_name)


def write_sample(root, request):
    """The scorer reads `<samples>/<id>/sample.json` and the seed folder."""
    start = request["startState"]
    folder = os.path.join(root, request["sampleId"])
    os.makedirs(os.path.join(folder, start))
    sample = {"start_state": start, "states": [{"state_id": start, "solution_folder": start}]}
    with open(os.path.join(folder, "sample.json"), "w") as f:
        json.dump(sample, f)
    for name, content in request["seedFiles"].items():
        with open(os.path.join(folder, start, name), "w") as f:
            f.write(content)


def score(request):
    repo = os.path.abspath(request["repo"])
    cls = load_domain(repo, request["domain"])
    captured = io.StringIO()
    with tempfile.TemporaryDirectory() as samples:
        write_sample(samples, request)
        cwd = os.getcwd()
        # Domain constructors read prompts/ relative to the working directory.
        os.chdir(repo)
        try:
            with contextlib.redirect_stdout(captured):
                scorer = cls()
                scorer.samples_folder = os.path.join(samples, "")
                target = {"state_id": request["startState"]}
                result = scorer.evaluate_context(request["sampleId"], request["files"], target)
        finally:
            os.chdir(cwd)
    value = result.get("score")
    details = {k: v for k, v in result.items() if k not in ("score", "error")}
    return {
        "score": None if value is None else float(value),
        "error": result.get("error"),
        "details": details,
        "scorerOutput": captured.getvalue(),
    }


def main():
    request = json.load(sys.stdin)
    json.dump(score(request), sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
