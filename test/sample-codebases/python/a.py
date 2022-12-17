import b.c
import threading
from b.fact import fact

def thread1():
    print(fact(6))


def thread2():
    print(b.c.deep("thread2"))


if __name__ == "__main__":
    print('Test basic recursion within a single file')
    print(fact(6))
    print()
    
    print('Test recursion between two files')
    print(b.c.recursive(6))
    print()

    print('Test a deep stack trace')
    print(b.c.deep("a"))
    print()

    print('Test threading')
    t1 = threading.Thread(target=thread1)
    t2 = threading.Thread(target=thread2)

    t1.start()
    t2.start()

    t1.join()
    t2.join()

    print("Done!")