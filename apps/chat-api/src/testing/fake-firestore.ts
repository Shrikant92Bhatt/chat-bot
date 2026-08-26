/**
 * Minimal in-memory stand-in for the handful of Firestore operations this
 * codebase's services actually use - doc get/set/delete, nested
 * subcollections (`users/{uid}/threads`), and single-field `where()`
 * equality queries. Just enough surface to mock `db/firestore.ts` in
 * service/route tests without a real Firestore emulator; not a general
 * reimplementation of Firestore semantics (no orderBy/limit/inequality
 * support - this codebase's own query rules, AGENTS.md §2b, avoid those on
 * the paths this fake needs to cover anyway).
 */

export type FakeDocData = Record<string, unknown>;

export interface FakeDocSnapshot {
  exists: boolean;
  data(): FakeDocData | undefined;
}

export interface FakeQuerySnapshot {
  docs: FakeDocSnapshot[];
}

export interface FakeDocRef {
  get(): Promise<FakeDocSnapshot>;
  set(data: FakeDocData, options?: { merge?: boolean }): Promise<void>;
  delete(): Promise<void>;
  collection(name: string): FakeCollectionRef;
}

export interface FakeCollectionRef {
  doc(id: string): FakeDocRef;
  where(field: string, op: '==', value: unknown): { get(): Promise<FakeQuerySnapshot> };
}

export interface FakeFirestore {
  collection(name: string): FakeCollectionRef;
}

/** Creates an isolated fake Firestore instance backed by a plain path->data
 *  map, so each test file gets its own store with no cross-test leakage. */
export function createFakeFirestore(): FakeFirestore {
  const store = new Map<string, FakeDocData>();

  function docRef(path: string): FakeDocRef {
    return {
      async get() {
        const data = store.get(path);
        return { exists: data !== undefined, data: () => data };
      },
      async set(data, options) {
        if (options?.merge) {
          store.set(path, { ...(store.get(path) ?? {}), ...data });
        } else {
          store.set(path, data);
        }
      },
      async delete() {
        store.delete(path);
      },
      collection(name: string) {
        return collectionRef(`${path}/${name}`);
      },
    };
  }

  function collectionRef(path: string): FakeCollectionRef {
    return {
      doc(id: string) {
        return docRef(`${path}/${id}`);
      },
      where(field: string, op: '==', value: unknown) {
        return {
          async get() {
            const prefix = `${path}/`;
            const docs: FakeDocSnapshot[] = [];
            store.forEach((data, key) => {
              // Only direct children of this collection path (not nested
              // subcollection docs, which would also start with `prefix`).
              if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
                if (op === '==' && data[field] === value) {
                  docs.push({ exists: true, data: () => data });
                }
              }
            });
            return { docs };
          },
        };
      },
    };
  }

  return {
    collection(name: string) {
      return collectionRef(name);
    },
  };
}
