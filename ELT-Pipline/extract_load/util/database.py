#!/usr/bin/env python3

import sqlalchemy as db
from sqlalchemy.engine import Connection


class DatabaseConnection:
    """Context Manager for Database Connection using SQL Alchemy."""

    def __init__(self, url: str):
        if not url:
            raise ValueError("Database URL is required for connection")

        try:
            self.pg_engine = db.create_engine(
                url,  # ✅ FIXED: removed name_or_url
                connect_args={'connect_timeout': 10}
            )
            self.connection: Connection = self.pg_engine.connect()
        except Exception as e:
            print('Something went wrong with connection:', e)
            raise  # ✅ Let the error propagate instead of failing silently

    def __enter__(self):
        return self.connection

    def __exit__(self, exc_type, exc_value, exc_traceback):
        self.connection.close()
