"""Browser export/whole-file fitting around the original schematic converter."""
import glob
import os
import schem_to_commands as core


def convert(argv, max_bytes, formatter):
    """Run the converter. Items always stay under the server's item-data limit;
    a positive max_bytes also keeps every exported item under that size."""
    max_bytes = int(max_bytes)
    if max_bytes < 0:
        raise ValueError('Max item size cannot be negative.')
    names = ('inspect_schematic_header', 'load_schematic', 'build_print', 'render_dynamic_item')
    original = {name: getattr(core, name) for name in names}
    old_limit = core.ITEM_FILL_PAYLOAD_LIMIT_BYTES
    cache = {}
    sizes = []

    def cached(name):
        def call(*args, **kwargs):
            if name not in cache:
                cache[name] = original[name](*args, **kwargs)
            return cache[name]
        return call

    for name in names[:3]:
        setattr(core, name, cached(name))

    def render(*args, **kwargs):
        text = str(formatter(original['render_dynamic_item'](*args, **kwargs))).rstrip('\n') + '\n'
        sizes.append(len(text.encode('utf-8')))
        return text

    core.render_dynamic_item = render
    payload_limit = max_bytes or old_limit
    old_enforce = core.ENFORCE_ITEM_LIMIT
    core.ENFORCE_ITEM_LIMIT = not max_bytes  # the user's own size is used as given
    try:
        for attempt in range(8):
            for path in glob.glob(os.path.join(os.path.dirname(argv[1]), 'result*.txt')):
                os.remove(path)
            sizes.clear()
            core.ITEM_FILL_PAYLOAD_LIMIT_BYTES = payload_limit
            code = core.main(argv)
            if code:
                return code
            finished = sizes
            if not max_bytes or (finished and max(finished) <= max_bytes):
                return 0
            overflow = max(finished) - max_bytes
            payload_limit = min(payload_limit, max_bytes) - overflow - 256
            if payload_limit <= 0:
                raise ValueError('Max item size is too small for the loader. Increase it and try again.')
            print(f'Fitting whole files to {max_bytes:,} bytes; splitting into smaller items…', flush=True)
        raise ValueError('Could not fit the items. Increase Max item size.')
    finally:
        for name, function in original.items():
            setattr(core, name, function)
        core.ITEM_FILL_PAYLOAD_LIMIT_BYTES = old_limit
        core.ENFORCE_ITEM_LIMIT = old_enforce
