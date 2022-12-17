from . import d

def recursive(n):
    if n <= 1:
        return 1
    else:
        return n * d.recursive(n - 1)

def deep(message):
    return d.deep(message + "-c")