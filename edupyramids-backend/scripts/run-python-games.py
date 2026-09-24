"""
Works out, by running real Python, the parts of a game nobody should type by
hand: what each Bug Catcher function returns for each test input, and every
step of a Trace Runner program.

    python scripts/run-python-games.py content/python-games.json          # fill in
    python scripts/run-python-games.py content/python-games.json --check  # CI

Authors write the code, the inputs and the bugged copies; this fills in
"outputs" (Bug Catcher) and "steps" (Trace Runner). --check changes nothing
and fails if the file disagrees with Python, so a hand edit that breaks an
answer cannot reach students.

Runs the code in the file, so only use it on content you trust.
"""
import ast
import contextlib
import io
import json
import sys

MAX_TRACE_STEPS = 14


def run_call(code, call, args_text):
    """repr() of what call(*args) returns, or the name of the error it raises."""
    scope = {}
    exec(compile(code, "<bugcatch>", "exec"), scope)
    args = ast.literal_eval(f"({args_text},)")
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            return repr(scope[call](*args))
    except Exception as err:  # the error is the output: that is what a test sees
        return type(err).__name__


def bugcatch_outputs(item):
    item["outputs"] = [run_call(item["code"], item["call"], a) for a in item["inputs"]]
    for m in item["mutants"]:
        m["outputs"] = [run_call(m["code"], item["call"], a) for a in item["inputs"]]
    return item


def assignments(code, watch):
    """
    Which watched names each line assigns, and for a for-loop header the lines
    of its body: the header assigns the loop variable only when the loop goes
    round again, not when it finishes.
    """
    assigns, bodies = {}, {}
    for node in ast.walk(ast.parse(code)):
        targets = []
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, (ast.AugAssign, ast.AnnAssign)):
            targets = [node.target]
        elif isinstance(node, ast.For):
            targets = [node.target]
            bodies[node.lineno] = (node.body[0].lineno, node.body[-1].end_lineno)
        names = [n.id for t in targets for n in ast.walk(t) if isinstance(n, ast.Name) and n.id in watch]
        if names:
            assigns.setdefault(node.lineno, []).extend(names)
    return assigns, bodies


def trace_steps(item):
    """
    Each time a line gives a watched variable a value, even the same value
    again: the line, the name, and repr() of the value. Module-level code only,
    so a student traces one frame.
    """
    code = item["code"]
    assigns, bodies = assignments(code, item["watch"])
    steps = []
    last_line = [None]

    def record(frame):
        line = last_line[0]
        if line not in assigns:
            return
        if line in bodies:
            first, last = bodies[line]
            if not first <= frame.f_lineno <= last:
                return  # the loop finished; nothing was assigned
        for name in assigns[line]:
            if name in frame.f_locals:
                steps.append({"line": line, "var": name, "value": repr(frame.f_locals[name])})

    def tracer(frame, event, arg):
        if frame.f_code.co_filename != "<trace>" or frame.f_code.co_name != "<module>":
            return tracer
        if event in ("line", "return"):
            record(frame)
            last_line[0] = frame.f_lineno if event == "line" else None
        return tracer

    scope = {}
    sys.settrace(tracer)
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            exec(compile(code, "<trace>", "exec"), scope)
    finally:
        sys.settrace(None)
    if len(steps) > MAX_TRACE_STEPS:
        raise ValueError(f"{len(steps)} steps; keep it to {MAX_TRACE_STEPS} or fewer")
    item["steps"] = steps
    return item


FILLERS = {"bugcatch": bugcatch_outputs, "trace": trace_steps}


def main():
    path = sys.argv[1]
    check = "--check" in sys.argv
    with open(path, encoding="utf-8") as f:
        topics = json.load(f)

    problems = []
    for topic in topics:
        for game in topic["games"]:
            fill = FILLERS.get(game["kind"])
            if not fill:
                continue
            for i, item in enumerate(game["items"]):
                before = json.dumps(item, sort_keys=True)
                try:
                    fill(item)
                except Exception as err:
                    problems.append(f'{game["title"]} item {i + 1}: {err}')
                    continue
                if check and json.dumps(item, sort_keys=True) != before:
                    problems.append(f'{game["title"]} item {i + 1}: stored answers differ from what Python gives')

    if problems:
        print("\n".join(problems), file=sys.stderr)
        sys.exit(1)
    if check:
        print("Bug Catcher and Trace Runner content matches Python.")
        return
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(topics, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("Filled in outputs and steps.")


if __name__ == "__main__":
    main()
