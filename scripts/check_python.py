"""Compile, never import or execute submitted Python. Also scan its AST."""
import ast
import pathlib
import py_compile
import sys
import tempfile

DENIED_MODULES = {"subprocess", "ctypes", "pty", "pickle", "marshal", "importlib", "multiprocessing", "code", "runpy", "socket", "base64", "codecs"}
DENIED_NAMES = {"eval", "exec", "compile", "__import__", "getattr", "setattr", "globals", "locals", "vars", "system", "popen", "spawn", "fork"}


def check(file):
    tree = ast.parse(file.read_text(encoding="utf-8"), filename=str(file))
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ""]
            if any(name.split(".")[0] in DENIED_MODULES for name in names):
                raise ValueError(f"{file}: prohibited import")
        if isinstance(node, ast.Name) and node.id in DENIED_NAMES:
            raise ValueError(f"{file}: prohibited dynamic capability")
        if isinstance(node, ast.Attribute) and (node.attr in DENIED_NAMES or node.attr.startswith("__")):
            raise ValueError(f"{file}: prohibited attribute")
    with tempfile.TemporaryDirectory() as scratch:
        py_compile.compile(str(file), cfile=str(pathlib.Path(scratch) / "compiled.pyc"), doraise=True)


if __name__ == "__main__":
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    files = list((root / "recipes").glob("*/scripts/*.py")) + list((root / "template" / "scripts").glob("*.py"))
    for candidate in files:
        if candidate.is_symlink() or not candidate.resolve().is_relative_to(root):
            raise ValueError("Unsafe Python path")
        check(candidate)
    print(f"Python AST and py_compile passed ({len(files)} files).")
