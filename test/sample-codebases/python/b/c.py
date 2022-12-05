from . import d

def fact(n):
    if n <= 1:
        return 1
    else:
        return n * fact(n - 1)

def recursive(n):
    if n <= 1:
        return 1
    else:
        return n * d.recursive(n - 1)
