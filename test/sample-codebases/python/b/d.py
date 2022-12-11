from . import c
from . import e

def recursive(n):
    if n <= 1:
        return 1
    else:
        return n * c.recursive(n - 1)

def deep(message):
    return e.deep(message + "-d")