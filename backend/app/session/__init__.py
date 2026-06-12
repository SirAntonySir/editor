"""Session engine — persistence, checkpointing, revive on restart.

The session-side counterpart to `app/state/` (which still owns the live
SessionDocument and event emission). This package adds the disk story:

- `persistence.py` — pure I/O to write/read the document.v1.json artifact
- `checkpointer.py` — schedules periodic + change-driven flushes
- `revive.py`      — restores in-memory state on backend startup

Phase 2 of the SSOT refactor. See ~/.claude/plans/okay-big-controll-we-elegant-seahorse.md
"""
