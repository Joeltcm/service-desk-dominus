"""File storage abstraction.

Uses Cloudflare R2 (S3-compatible) when R2_* env vars are configured.
Falls back to local disk (UPLOAD_DIR) otherwise, so local development
keeps working without R2 credentials.

Keys are forward-slash relative paths, e.g. "42/abc123.png" or
"expenses/7/abc123.pdf" — the same layout the app used on local disk.
"""
import os
import logging

logger = logging.getLogger(__name__)

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "uploads")

_R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID")
_R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
_R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
_R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME")

R2_ENABLED = bool(_R2_ACCOUNT_ID and _R2_ACCESS_KEY_ID and _R2_SECRET_ACCESS_KEY and _R2_BUCKET_NAME)

_client = None


def _get_client():
    global _client
    if _client is None:
        import boto3
        from botocore.client import Config
        _client = boto3.client(
            "s3",
            endpoint_url=f"https://{_R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
            aws_access_key_id=_R2_ACCESS_KEY_ID,
            aws_secret_access_key=_R2_SECRET_ACCESS_KEY,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
    return _client


def save_file(key: str, data: bytes, content_type: str = None) -> None:
    if R2_ENABLED:
        extra = {"ContentType": content_type} if content_type else {}
        _get_client().put_object(Bucket=_R2_BUCKET_NAME, Key=key, Body=data, **extra)
        return
    path = os.path.join(UPLOAD_DIR, key)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def read_file(key: str) -> bytes:
    if R2_ENABLED:
        from botocore.exceptions import ClientError
        try:
            obj = _get_client().get_object(Bucket=_R2_BUCKET_NAME, Key=key)
            return obj["Body"].read()
        except ClientError:
            # Fallback: serve pre-migration files still on the Railway Volume
            local = os.path.join(UPLOAD_DIR, key)
            if os.path.exists(local):
                with open(local, "rb") as f:
                    return f.read()
            raise
    path = os.path.join(UPLOAD_DIR, key)
    with open(path, "rb") as f:
        return f.read()


def file_exists(key: str) -> bool:
    if R2_ENABLED:
        from botocore.exceptions import ClientError
        try:
            _get_client().head_object(Bucket=_R2_BUCKET_NAME, Key=key)
            return True
        except ClientError:
            # Fallback: pre-migration files on the Railway Volume
            return os.path.exists(os.path.join(UPLOAD_DIR, key))
    return os.path.exists(os.path.join(UPLOAD_DIR, key))


def delete_file(key: str) -> None:
    if R2_ENABLED:
        from botocore.exceptions import ClientError
        try:
            _get_client().delete_object(Bucket=_R2_BUCKET_NAME, Key=key)
        except ClientError as e:
            logger.warning("R2 delete failed for %s: %s", key, e)
        return
    path = os.path.join(UPLOAD_DIR, key)
    if os.path.exists(path):
        os.remove(path)
