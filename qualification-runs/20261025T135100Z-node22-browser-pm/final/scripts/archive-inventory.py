import json, pathlib, sys, tarfile
rows = []
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    for member in archive.getmembers():
        entry = pathlib.PurePosixPath(member.name)
        assert not entry.is_absolute() and '..' not in entry.parts and entry.parts[0] == 'package', member.name
        assert member.isfile() and not member.issym() and not member.islnk(), member.name
        assert member.mode in (0o644, 0o755), (member.name, oct(member.mode))
        rows.append({'path': '/'.join(entry.parts[1:]), 'bytes': member.size, 'mode': member.mode, 'type': 'regular'})
assert len({row['path'] for row in rows}) == len(rows)
print(json.dumps(rows, indent=2))
