//! Locks that outlive a panic.
//!
//! A thread that panics while it holds a `Mutex` or `RwLock` poisons it, and
//! every later unwrapped `lock()` panics in turn: one bad OCR read or hotkey
//! handler would take every window, command and background task that touches
//! the same state down with it. Nothing the client keeps behind a lock is a
//! multi-step invariant a half-finished update could break in a dangerous way
//! — it is caches, flags, last results and handles — so the data is used as the
//! panicking thread left it. A lock whose poisoned contents must not be used
//! takes `.lock()` and handles the error itself, with a comment saying why.

use std::sync::{Mutex, MutexGuard, RwLock, RwLockReadGuard, RwLockWriteGuard};

pub(crate) trait LockExt<T: ?Sized> {
    /// `lock()`, taking the guard back from a poisoned lock instead of panicking.
    fn lock_or_recover(&self) -> MutexGuard<'_, T>;
}

impl<T: ?Sized> LockExt<T> for Mutex<T> {
    fn lock_or_recover(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(|e| e.into_inner())
    }
}

pub(crate) trait RwLockExt<T: ?Sized> {
    /// `read()`, taking the guard back from a poisoned lock instead of panicking.
    fn read_or_recover(&self) -> RwLockReadGuard<'_, T>;
    /// `write()`, taking the guard back from a poisoned lock instead of panicking.
    fn write_or_recover(&self) -> RwLockWriteGuard<'_, T>;
}

impl<T: ?Sized> RwLockExt<T> for RwLock<T> {
    fn read_or_recover(&self) -> RwLockReadGuard<'_, T> {
        self.read().unwrap_or_else(|e| e.into_inner())
    }

    fn write_or_recover(&self) -> RwLockWriteGuard<'_, T> {
        self.write().unwrap_or_else(|e| e.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn a_panic_while_holding_a_lock_does_not_take_the_next_caller_down() {
        let shared = Arc::new(Mutex::new(1));
        let held = shared.clone();
        let _ = std::thread::spawn(move || {
            let mut guard = held.lock().expect("not poisoned yet");
            *guard = 2;
            panic!("poison it");
        })
        .join();
        assert!(shared.is_poisoned());
        assert_eq!(*shared.lock_or_recover(), 2);

        let shared = Arc::new(RwLock::new(1));
        let held = shared.clone();
        let _ = std::thread::spawn(move || {
            let _guard = held.write().expect("not poisoned yet");
            panic!("poison it");
        })
        .join();
        assert!(shared.is_poisoned());
        *shared.write_or_recover() = 3;
        assert_eq!(*shared.read_or_recover(), 3);
    }
}
