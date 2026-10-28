import { SheetbaseError } from './types.js';
function invalid(header, detail) { throw new SheetbaseError('invalid-value', `${header}: ${detail}`); }
function make(header, codec, encode, decode) {
    if (!header.trim() || header.length > 200)
        invalid(header, 'Use a non-empty header of at most 200 characters.');
    return Object.freeze({ header, codec,
        encode(value) { if (value === null)
            return ''; const text = encode(value); if (typeof text !== 'string' || !text.length || text.length > 40000)
            invalid(header, 'Encoded values must contain 1–40000 characters. Use null to clear.'); return text; },
        decode(value) { return value === '' ? null : decode(value); },
    });
}
export const column = {
    text(header) {
        return make(header, 'text:v1', (value) => { if (typeof value !== 'string')
            invalid(header, 'Expected text.'); return value; }, (value) => value);
    },
    number(header) {
        const parse = (value) => { if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(Number(value)))
            invalid(header, 'Expected a finite number.'); return Number(value); };
        return make(header, 'number:v1', (value) => { if (typeof value !== 'number' || !Number.isFinite(value))
            invalid(header, 'Expected a finite number.'); return String(value); }, parse);
    },
    boolean(header, checked = '✓') {
        if (!checked || checked === 'FALSE')
            invalid(header, 'The checked marker must differ from FALSE and empty.');
        return make(header, `boolean:v1:${checked}`, (value) => { if (typeof value !== 'boolean')
            invalid(header, 'Expected true or false.'); return value ? checked : 'FALSE'; }, (value) => {
            if (value === checked)
                return true;
            if (value === 'FALSE')
                return false;
            return invalid(header, 'Expected the checked marker or FALSE.');
        });
    },
    json(header, validate, version = 'v1') {
        const verify = (value) => { if (!validate(value))
            invalid(header, 'JSON does not match its validator.'); return value; };
        return make(header, `json:${version}`, (value) => JSON.stringify(verify(value)), (value) => { try {
            return verify(JSON.parse(value));
        }
        catch (error) {
            return invalid(header, error instanceof Error ? error.message : 'Invalid JSON.');
        } });
    },
    custom(header, options) {
        if (!options.id.trim())
            invalid(header, 'Custom codecs need a stable versioned ID.');
        return make(header, `custom:${options.id}`, options.encode, options.decode);
    },
};
//# sourceMappingURL=columns.js.map