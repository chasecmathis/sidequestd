"""Outbound email.

Local development points SMTP at the Mailpit container, so nothing leaves the
machine and every message is readable at http://localhost:8025.
"""

from __future__ import annotations

import logging
from email.message import EmailMessage

import aiosmtplib

from app.core.config import settings

logger = logging.getLogger(__name__)


async def send_email(
    *, to: str, subject: str, text_body: str, html_body: str | None = None
) -> None:
    """Send one message. Failures are logged, not raised.

    Callers are user-facing endpoints whose contract is "we may have sent you an
    email" — a dead SMTP host must not turn into a 500 that also leaks whether
    the address exists.
    """
    message = EmailMessage()
    message["From"] = f"{settings.email_from_name} <{settings.email_from}>"
    message["To"] = to
    message["Subject"] = subject
    message.set_content(text_body)
    if html_body:
        message.add_alternative(html_body, subtype="html")

    try:
        await aiosmtplib.send(
            message,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_user,
            password=settings.smtp_password,
            start_tls=settings.smtp_use_tls,
        )
    except (aiosmtplib.SMTPException, OSError):
        logger.exception("Failed to send %r email to %s", subject, to)
    else:
        logger.info("Sent %r email to %s", subject, to)


async def send_password_reset_email(*, to: str, username: str, reset_url: str) -> None:
    minutes = settings.password_reset_ttl_minutes
    text_body = (
        f"Hi {username},\n\n"
        "We received a request to reset your Sidequestd password.\n\n"
        f"Reset it here: {reset_url}\n\n"
        f"This link expires in {minutes} minutes and can only be used once.\n"
        "If you didn't ask for this, you can safely ignore this email.\n\n"
        "— Sidequestd\n"
    )
    html_body = (
        f"<p>Hi {username},</p>"
        "<p>We received a request to reset your Sidequestd password.</p>"
        f'<p><a href="{reset_url}">Reset your password</a></p>'
        f"<p>This link expires in {minutes} minutes and can only be used once. "
        "If you didn't ask for this, you can safely ignore this email.</p>"
        "<p>— Sidequestd</p>"
    )
    await send_email(
        to=to,
        subject="Reset your Sidequestd password",
        text_body=text_body,
        html_body=html_body,
    )
