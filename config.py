"""
Branding + global settings.
"""
from dataclasses import dataclass
from datetime import date
from pathlib import Path


@dataclass
class Company:
    name: str = "New England Truck Center"
    email: str = "netcar@netruckcenter.com"
    phone: str = "(603) 778-8158"
    address: str = "156 Epping Rd.\nExeter, NH 03833"
    remit_to: str = (
        "New England Truck Center\n"
        "Accounts Receivable\n"
        "156 Epping Rd.\n"
        "Exeter, NH 03833\n"
        "Email: netcar@netruckcenter.com\n"
        "Phone: (603) 778-8158"
    )
    pay_now_url: str = None
    logo_src: str = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRwHR6UBXCrejLzK29Th-EPysfj2vX2ZIaRsg&s"


@dataclass
class Settings:
    as_of: date = date.today()
    output_root: Path | None = None


# Canonical aging labels & normalizations
BUCKET_CANON = ["Current", "1-30", "31-60", "61-90", "90+"]
BUCKET_MAP = {"Over 90": "90+", ">90": "90+", "0-30": "1-30", "0 – 30": "1-30", "0–30": "1-30"}
