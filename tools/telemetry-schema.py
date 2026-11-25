#!/usr/bin/env python3
"""Print the layout of Star Citizen's game telemetry stream for one build.

The game carries the protobuf schema of its local telemetry service
(sc.game.telemetry.v1) inside StarCitizen.exe. This finds the two schema
files in the exe and prints every message, field, enum and RPC, so a new build
can be checked for new data (a position, say) in a minute.

Reads the exe and build_manifest.id, changes nothing. Plain Python 3.9+, no
packages needed.

    python3 tools/telemetry-schema.py                   # PTU, default install
    python3 tools/telemetry-schema.py --channel LIVE
    python3 tools/telemetry-schema.py --root "D:/Games/StarCitizen"
    python3 tools/telemetry-schema.py --exe path/to/StarCitizen.exe
"""

import argparse
import json
import os
import sys

FILES = ["sc/game/telemetry/v1/types.proto", "sc/game/telemetry/v1/api.proto"]

TYPES = {
    1: "double", 2: "float", 3: "int64", 4: "uint64", 5: "int32", 6: "fixed64", 7: "fixed32",
    8: "bool", 9: "string", 12: "bytes", 13: "uint32", 15: "sfixed32", 16: "sfixed64",
    17: "sint32", 18: "sint64",
}

# FileDescriptorProto's fields and their wire types: the descriptor ends at the
# first tag that is not one of these.
FILE_FIELDS = {1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 2, 10: 0, 11: 0, 12: 2, 14: 0}


def default_root():
    if os.name == "nt":
        return r"C:\Program Files\Roberts Space Industries\StarCitizen"
    wine = os.path.expanduser("~/Games/star-citizen/drive_c/Program Files/Roberts Space Industries/StarCitizen")
    return wine


def varint(b, i):
    r = s = 0
    while True:
        x = b[i]
        i += 1
        r |= (x & 0x7F) << s
        s += 7
        if x < 0x80:
            return r, i


def fields(b):
    """(number, wire type, value) for each field of a message."""
    i, out = 0, []
    while i < len(b):
        k, i = varint(b, i)
        f, w = k >> 3, k & 7
        if w == 0:
            v, i = varint(b, i)
        elif w == 2:
            n, i = varint(b, i)
            v, i = b[i : i + n], i + n
        elif w == 1:
            v, i = b[i : i + 8], i + 8
        elif w == 5:
            v, i = b[i : i + 4], i + 4
        else:
            raise ValueError(f"wire type {w}")
        if i > len(b):
            raise ValueError("runs past the end")
        out.append((f, w, v))
    return out


def find_descriptor(data, name):
    """The bytes of the serialized FileDescriptorProto named `name`."""
    key = name.encode()
    start = data.find(b"\n" + bytes([len(key)]) + key)
    if start < 0:
        return None
    i = start
    while i < len(data):
        try:
            k, j = varint(data, i)
        except IndexError:
            break
        f, w = k >> 3, k & 7
        if FILE_FIELDS.get(f) != w:
            break
        if w == 0:
            _, j = varint(data, j)
        else:
            n, j = varint(data, j)
            j += n
        i = j
    return data[start:i]


def text(v):
    return v.decode("utf-8", "replace")


def show_enum(b, ind, out):
    fs = fields(b)
    name = next(text(v) for f, _, v in fs if f == 1)
    out.append(f"{ind}enum {name} {{")
    for f, _, v in fs:
        if f == 2:
            d = {ff: vv for ff, _, vv in fields(v)}
            out.append(f"{ind}  {text(d[1])} = {d.get(2, 0)};")
    out.append(f"{ind}}}")


def show_message(b, ind, out):
    fs = fields(b)
    name = next(text(v) for f, _, v in fs if f == 1)
    out.append(f"{ind}message {name} {{")
    for f, _, v in fs:
        if f == 2:
            d = {ff: vv for ff, _, vv in fields(v)}
            label = "repeated " if d.get(4) == 3 else ""
            kind = text(d[6]).removeprefix(".sc.game.telemetry.v1.") if 6 in d else TYPES.get(d.get(5), f"type{d.get(5)}")
            out.append(f"{ind}  {label}{kind} {text(d[1])} = {d[3]};")
        elif f == 3:
            show_message(v, ind + "  ", out)
        elif f == 4:
            show_enum(v, ind + "  ", out)
    out.append(f"{ind}}}")


def show_file(desc):
    out = []
    for f, _, v in fields(desc):
        if f == 1:
            out.append(f"// {text(v)}")
        elif f == 4:
            show_message(v, "", out)
        elif f == 5:
            show_enum(v, "", out)
        elif f == 6:
            sf = fields(v)
            out.append(f"service {next(text(x) for n, _, x in sf if n == 1)} {{")
            for n, _, x in sf:
                if n == 2:
                    d = {ff: vv for ff, _, vv in fields(x)}
                    req = text(d[2]).removeprefix(".sc.game.telemetry.v1.")
                    resp = text(d[3]).removeprefix(".sc.game.telemetry.v1.")
                    stream = "stream " if d.get(6) else ""
                    out.append(f"  rpc {text(d[1])}({req}) returns ({stream}{resp});")
            out.append("}")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", default=default_root(), help="the folder that holds LIVE, PTU and the other channels")
    ap.add_argument("--channel", default="PTU", help="the channel folder to read (default PTU)")
    ap.add_argument("--exe", help="read this StarCitizen.exe instead of the channel's")
    a = ap.parse_args()

    exe = a.exe or os.path.join(a.root, a.channel, "Bin64", "StarCitizen.exe")
    if not os.path.isfile(exe):
        sys.exit(f"{exe} not found")
    manifest = os.path.join(os.path.dirname(os.path.dirname(exe)), "build_manifest.id")
    try:
        m = json.load(open(manifest, encoding="utf-8"))["Data"]
        print(f"// {m['Branch']} {m['Version']}, changelist {m['RequestedP4ChangeNum']}, built {m['BuildDateStamp']}")
    except (OSError, KeyError, ValueError):
        print(f"// {exe}")

    data = open(exe, "rb").read()
    found = False
    for name in FILES:
        desc = find_descriptor(data, name)
        if desc is None:
            print(f"\n// {name}: not in this build")
            continue
        found = True
        print()
        print("\n".join(show_file(desc)))
    if not found:
        sys.exit("No game telemetry in this build.")


if __name__ == "__main__":
    main()
