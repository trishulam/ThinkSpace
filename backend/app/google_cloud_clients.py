"""Shared cached Google Cloud clients for backend stores."""

from __future__ import annotations

from functools import lru_cache

import google.cloud.firestore as firestore
import google.cloud.storage as storage


@lru_cache(maxsize=None)
def get_firestore_client(
    *, project: str | None = None, database: str | None = None
) -> firestore.Client:
    """Return a cached Firestore client for the given project/database pair."""

    return firestore.Client(project=project, database=database)


@lru_cache(maxsize=None)
def get_storage_client(*, project: str | None = None) -> storage.Client:
    """Return a cached Cloud Storage client for the given project."""

    return storage.Client(project=project)
