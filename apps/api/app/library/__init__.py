"""The 3D model library: the catalogue (catalog.py), picking models for a lesson (router.py) and real-world sizes
(real_size.py). The catalogue's functions are re-exported here, so `from app import library` reads it."""

from app.library.catalog import (
    asset_path,
    clear_catalog_cache,
    library_catalog,
    library_dir,
    library_section,
    short_credit,
)

__all__ = ["asset_path", "clear_catalog_cache", "library_catalog", "library_dir", "library_section", "short_credit"]
