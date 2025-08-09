#!/usr/bin/env python3
"""
Entry point: runs the AR statement builder for New England Truck Center.

- Zero args: auto-detects the latest CSV and uses today's date
- Optional flags: --input, --as-of, --outdir, --logo
"""
import argparse
from pathlib import Path

from pipeline import build_all


def main():
    ap = argparse.ArgumentParser("NETC AR Statement Builder")
    ap.add_argument("--input", help="Path to AR detail CSV (QuickBooks export). If omitted, we auto-detect.",
                    default=None)
    ap.add_argument("--as-of", help="As-of date in YYYY-MM-DD (default: today).", default=None)
    ap.add_argument("--outdir", help="Output directory (default: ./Customer_Statements_<date>).", default=None)
    ap.add_argument("--logo", help="Optional logo image path to display on statements.", default=None)
    args = ap.parse_args()

    build_all(
        input_csv=args.input,
        as_of_str=args.as_of,
        outdir=Path(args.outdir) if args.outdir else None,
        logo_override=args.logo,
    )


if __name__ == "__main__":
    main()
