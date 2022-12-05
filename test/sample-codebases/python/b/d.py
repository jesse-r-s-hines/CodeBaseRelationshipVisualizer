from . import c

def recursive(n):
    if n <= 1:
        return 1
    else:
        return n * c.recursive(n - 1)
