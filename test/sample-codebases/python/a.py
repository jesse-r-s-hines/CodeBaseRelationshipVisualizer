import b.c
import threading

def thread1():
    for i in range(10):
        print(i)

def thread2():
    for i in range(10):
        print(i)

if __name__ == "__main__":
    print(b.c.fact(6))
    print(b.c.recursive(6))

    t1 = threading.Thread(target=thread1)
    t2 = threading.Thread(target=thread2)

    t1.start()
    t2.start()

    t1.join()
    t2.join()

    print("Done!")