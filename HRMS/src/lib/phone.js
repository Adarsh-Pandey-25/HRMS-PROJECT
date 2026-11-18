/**
 * Phone numbers from any country — the website's copy of the server's rules
 * (backend/src/utils/phone.js: same country list, same checks). A change
 * there must be made here too.
 *
 * How a number is kept: an Indian number exactly as before, its 10 digits
 * with no country code ("9876543210"); any other country's number with "+"
 * and its country code ("+971501234567"). A number written without "+" is
 * always read as Indian.
 */

// <countries>
// [ISO code, country, country code, shortest, longest number after the
// country code (without the leading 0 dialled at home), the leading 0 is
// part of the number]. Lengths are generous where a country's numbers vary.
const COUNTRY_ROWS = [
  ['AF', 'Afghanistan', '93', 9, 9],
  ['AX', 'Åland Islands', '358', 5, 12],
  ['AL', 'Albania', '355', 8, 9],
  ['DZ', 'Algeria', '213', 8, 9],
  ['AS', 'American Samoa', '1', 10, 10],
  ['AD', 'Andorra', '376', 6, 9],
  ['AO', 'Angola', '244', 9, 9],
  ['AI', 'Anguilla', '1', 10, 10],
  ['AG', 'Antigua and Barbuda', '1', 10, 10],
  ['AR', 'Argentina', '54', 10, 11],
  ['AM', 'Armenia', '374', 8, 8],
  ['AW', 'Aruba', '297', 7, 7],
  ['AC', 'Ascension Island', '247', 4, 6],
  ['AU', 'Australia', '61', 9, 9],
  ['AT', 'Austria', '43', 4, 13],
  ['AZ', 'Azerbaijan', '994', 9, 9],
  ['BS', 'Bahamas', '1', 10, 10],
  ['BH', 'Bahrain', '973', 8, 8],
  ['BD', 'Bangladesh', '880', 6, 10],
  ['BB', 'Barbados', '1', 10, 10],
  ['BY', 'Belarus', '375', 9, 10],
  ['BE', 'Belgium', '32', 8, 9],
  ['BZ', 'Belize', '501', 7, 7],
  ['BJ', 'Benin', '229', 8, 10, true],
  ['BM', 'Bermuda', '1', 10, 10],
  ['BT', 'Bhutan', '975', 7, 8],
  ['BO', 'Bolivia', '591', 8, 8],
  ['BA', 'Bosnia and Herzegovina', '387', 8, 9],
  ['BW', 'Botswana', '267', 7, 8],
  ['BR', 'Brazil', '55', 10, 11],
  ['IO', 'British Indian Ocean Territory', '246', 7, 7],
  ['VG', 'British Virgin Islands', '1', 10, 10],
  ['BN', 'Brunei', '673', 7, 7],
  ['BG', 'Bulgaria', '359', 6, 9],
  ['BF', 'Burkina Faso', '226', 8, 8],
  ['BI', 'Burundi', '257', 8, 8],
  ['KH', 'Cambodia', '855', 8, 9],
  ['CM', 'Cameroon', '237', 8, 9],
  ['CA', 'Canada', '1', 10, 10],
  ['CV', 'Cape Verde', '238', 7, 7],
  ['BQ', 'Caribbean Netherlands', '599', 7, 7],
  ['KY', 'Cayman Islands', '1', 10, 10],
  ['CF', 'Central African Republic', '236', 8, 8],
  ['TD', 'Chad', '235', 8, 8],
  ['CL', 'Chile', '56', 9, 9],
  ['CN', 'China', '86', 7, 12],
  ['CX', 'Christmas Island', '61', 9, 9],
  ['CC', 'Cocos (Keeling) Islands', '61', 9, 9],
  ['CO', 'Colombia', '57', 8, 10],
  ['KM', 'Comoros', '269', 7, 7],
  ['CG', 'Congo - Brazzaville', '242', 9, 9, true],
  ['CD', 'Congo - Kinshasa', '243', 7, 9],
  ['CK', 'Cook Islands', '682', 5, 5],
  ['CR', 'Costa Rica', '506', 8, 8],
  ['CI', 'Côte d’Ivoire', '225', 8, 10, true],
  ['HR', 'Croatia', '385', 6, 9],
  ['CU', 'Cuba', '53', 6, 8],
  ['CW', 'Curaçao', '599', 7, 8],
  ['CY', 'Cyprus', '357', 8, 8],
  ['CZ', 'Czechia', '420', 9, 9],
  ['DK', 'Denmark', '45', 8, 8],
  ['DJ', 'Djibouti', '253', 8, 8],
  ['DM', 'Dominica', '1', 10, 10],
  ['DO', 'Dominican Republic', '1', 10, 10],
  ['EC', 'Ecuador', '593', 8, 9],
  ['EG', 'Egypt', '20', 8, 10],
  ['SV', 'El Salvador', '503', 7, 8],
  ['GQ', 'Equatorial Guinea', '240', 9, 9],
  ['ER', 'Eritrea', '291', 7, 7],
  ['EE', 'Estonia', '372', 7, 8],
  ['SZ', 'Eswatini', '268', 8, 8],
  ['ET', 'Ethiopia', '251', 9, 9],
  ['FK', 'Falkland Islands', '500', 5, 5],
  ['FO', 'Faroe Islands', '298', 6, 6],
  ['FJ', 'Fiji', '679', 7, 7],
  ['FI', 'Finland', '358', 5, 12],
  ['FR', 'France', '33', 9, 9],
  ['GF', 'French Guiana', '594', 9, 9],
  ['PF', 'French Polynesia', '689', 6, 8],
  ['GA', 'Gabon', '241', 7, 8, true],
  ['GM', 'Gambia', '220', 7, 7],
  ['GE', 'Georgia', '995', 9, 9],
  ['DE', 'Germany', '49', 5, 13],
  ['GH', 'Ghana', '233', 9, 9],
  ['GI', 'Gibraltar', '350', 8, 8],
  ['GR', 'Greece', '30', 10, 10],
  ['GL', 'Greenland', '299', 6, 6],
  ['GD', 'Grenada', '1', 10, 10],
  ['GP', 'Guadeloupe', '590', 9, 9],
  ['GU', 'Guam', '1', 10, 10],
  ['GT', 'Guatemala', '502', 8, 8],
  ['GG', 'Guernsey', '44', 7, 10],
  ['GN', 'Guinea', '224', 8, 9],
  ['GW', 'Guinea-Bissau', '245', 7, 9],
  ['GY', 'Guyana', '592', 7, 7],
  ['HT', 'Haiti', '509', 8, 8],
  ['HN', 'Honduras', '504', 8, 8],
  ['HK', 'Hong Kong', '852', 8, 9],
  ['HU', 'Hungary', '36', 8, 9],
  ['IS', 'Iceland', '354', 7, 9],
  ['IN', 'India', '91', 10, 10],
  ['ID', 'Indonesia', '62', 7, 12],
  ['IR', 'Iran', '98', 10, 10],
  ['IQ', 'Iraq', '964', 8, 10],
  ['IE', 'Ireland', '353', 7, 9],
  ['IM', 'Isle of Man', '44', 7, 10],
  ['IL', 'Israel', '972', 8, 9],
  ['IT', 'Italy', '39', 6, 11, true],
  ['JM', 'Jamaica', '1', 10, 10],
  ['JP', 'Japan', '81', 9, 10],
  ['JE', 'Jersey', '44', 7, 10],
  ['JO', 'Jordan', '962', 8, 9],
  ['KZ', 'Kazakhstan', '7', 10, 10],
  ['KE', 'Kenya', '254', 8, 10],
  ['KI', 'Kiribati', '686', 5, 8],
  ['XK', 'Kosovo', '383', 8, 9],
  ['KW', 'Kuwait', '965', 7, 8],
  ['KG', 'Kyrgyzstan', '996', 9, 9],
  ['LA', 'Laos', '856', 8, 10],
  ['LV', 'Latvia', '371', 8, 8],
  ['LB', 'Lebanon', '961', 7, 8],
  ['LS', 'Lesotho', '266', 8, 8],
  ['LR', 'Liberia', '231', 7, 9],
  ['LY', 'Libya', '218', 8, 9],
  ['LI', 'Liechtenstein', '423', 7, 9],
  ['LT', 'Lithuania', '370', 8, 8],
  ['LU', 'Luxembourg', '352', 4, 11],
  ['MO', 'Macao', '853', 8, 8],
  ['MG', 'Madagascar', '261', 9, 9],
  ['MW', 'Malawi', '265', 7, 9],
  ['MY', 'Malaysia', '60', 8, 10],
  ['MV', 'Maldives', '960', 7, 7],
  ['ML', 'Mali', '223', 8, 8],
  ['MT', 'Malta', '356', 8, 8],
  ['MH', 'Marshall Islands', '692', 7, 7],
  ['MQ', 'Martinique', '596', 9, 9],
  ['MR', 'Mauritania', '222', 8, 8],
  ['MU', 'Mauritius', '230', 7, 8],
  ['YT', 'Mayotte', '262', 9, 9],
  ['MX', 'Mexico', '52', 10, 11],
  ['FM', 'Micronesia', '691', 7, 7],
  ['MD', 'Moldova', '373', 8, 8],
  ['MC', 'Monaco', '377', 8, 9],
  ['MN', 'Mongolia', '976', 6, 10],
  ['ME', 'Montenegro', '382', 8, 9],
  ['MS', 'Montserrat', '1', 10, 10],
  ['MA', 'Morocco', '212', 9, 9],
  ['MZ', 'Mozambique', '258', 8, 9],
  ['MM', 'Myanmar', '95', 6, 10],
  ['NA', 'Namibia', '264', 6, 10],
  ['NR', 'Nauru', '674', 7, 7],
  ['NP', 'Nepal', '977', 8, 10],
  ['NL', 'Netherlands', '31', 9, 9],
  ['NC', 'New Caledonia', '687', 6, 6],
  ['NZ', 'New Zealand', '64', 8, 10],
  ['NI', 'Nicaragua', '505', 8, 8],
  ['NE', 'Niger', '227', 8, 8],
  ['NG', 'Nigeria', '234', 7, 10],
  ['NU', 'Niue', '683', 4, 7],
  ['NF', 'Norfolk Island', '672', 5, 6],
  ['KP', 'North Korea', '850', 6, 10],
  ['MK', 'North Macedonia', '389', 8, 8],
  ['MP', 'Northern Mariana Islands', '1', 10, 10],
  ['NO', 'Norway', '47', 8, 8],
  ['OM', 'Oman', '968', 7, 9],
  ['PK', 'Pakistan', '92', 8, 11],
  ['PW', 'Palau', '680', 7, 7],
  ['PS', 'Palestine', '970', 8, 9],
  ['PA', 'Panama', '507', 7, 8],
  ['PG', 'Papua New Guinea', '675', 7, 8],
  ['PY', 'Paraguay', '595', 6, 9],
  ['PE', 'Peru', '51', 8, 9],
  ['PH', 'Philippines', '63', 8, 10],
  ['PL', 'Poland', '48', 9, 9],
  ['PT', 'Portugal', '351', 9, 9],
  ['PR', 'Puerto Rico', '1', 10, 10],
  ['QA', 'Qatar', '974', 7, 8],
  ['RE', 'Réunion', '262', 9, 9],
  ['RO', 'Romania', '40', 9, 9],
  ['RU', 'Russia', '7', 10, 10],
  ['RW', 'Rwanda', '250', 9, 9],
  ['BL', 'Saint Barthélemy', '590', 9, 9],
  ['SH', 'Saint Helena', '290', 4, 5],
  ['KN', 'Saint Kitts and Nevis', '1', 10, 10],
  ['LC', 'Saint Lucia', '1', 10, 10],
  ['MF', 'Saint Martin', '590', 9, 9],
  ['PM', 'Saint Pierre and Miquelon', '508', 6, 6],
  ['VC', 'Saint Vincent and the Grenadines', '1', 10, 10],
  ['WS', 'Samoa', '685', 5, 7],
  ['SM', 'San Marino', '378', 6, 10, true],
  ['ST', 'São Tomé and Príncipe', '239', 7, 7],
  ['SA', 'Saudi Arabia', '966', 8, 9],
  ['SN', 'Senegal', '221', 9, 9],
  ['RS', 'Serbia', '381', 6, 12],
  ['SC', 'Seychelles', '248', 7, 7],
  ['SL', 'Sierra Leone', '232', 8, 8],
  ['SG', 'Singapore', '65', 8, 8],
  ['SX', 'Sint Maarten', '1', 10, 10],
  ['SK', 'Slovakia', '421', 6, 9],
  ['SI', 'Slovenia', '386', 8, 8],
  ['SB', 'Solomon Islands', '677', 5, 7],
  ['SO', 'Somalia', '252', 6, 9],
  ['ZA', 'South Africa', '27', 9, 9],
  ['KR', 'South Korea', '82', 7, 10],
  ['SS', 'South Sudan', '211', 9, 9],
  ['ES', 'Spain', '34', 9, 9],
  ['LK', 'Sri Lanka', '94', 9, 9],
  ['SD', 'Sudan', '249', 9, 9],
  ['SR', 'Suriname', '597', 6, 7],
  ['SJ', 'Svalbard and Jan Mayen', '47', 8, 8],
  ['SE', 'Sweden', '46', 6, 10],
  ['CH', 'Switzerland', '41', 9, 9],
  ['SY', 'Syria', '963', 8, 9],
  ['TW', 'Taiwan', '886', 7, 10],
  ['TJ', 'Tajikistan', '992', 9, 9],
  ['TZ', 'Tanzania', '255', 9, 9],
  ['TH', 'Thailand', '66', 8, 9],
  ['TL', 'Timor-Leste', '670', 7, 8],
  ['TG', 'Togo', '228', 8, 8],
  ['TK', 'Tokelau', '690', 4, 7],
  ['TO', 'Tonga', '676', 5, 7],
  ['TT', 'Trinidad and Tobago', '1', 10, 10],
  ['TN', 'Tunisia', '216', 8, 8],
  ['TR', 'Türkiye', '90', 10, 10],
  ['TM', 'Turkmenistan', '993', 8, 8],
  ['TC', 'Turks and Caicos Islands', '1', 10, 10],
  ['TV', 'Tuvalu', '688', 5, 7],
  ['VI', 'U.S. Virgin Islands', '1', 10, 10],
  ['UG', 'Uganda', '256', 9, 9],
  ['UA', 'Ukraine', '380', 9, 9],
  ['AE', 'United Arab Emirates', '971', 8, 9],
  ['GB', 'United Kingdom', '44', 7, 10],
  ['US', 'United States', '1', 10, 10],
  ['UY', 'Uruguay', '598', 8, 8],
  ['UZ', 'Uzbekistan', '998', 9, 9],
  ['VU', 'Vanuatu', '678', 5, 7],
  ['VA', 'Vatican City', '39', 6, 11, true],
  ['VE', 'Venezuela', '58', 10, 10],
  ['VN', 'Vietnam', '84', 9, 10],
  ['WF', 'Wallis and Futuna', '681', 6, 6],
  ['EH', 'Western Sahara', '212', 9, 9],
  ['YE', 'Yemen', '967', 7, 9],
  ['ZM', 'Zambia', '260', 9, 9],
  ['ZW', 'Zimbabwe', '263', 5, 10],
];
// Where countries share a country code, the one a stored number is shown as.
const SHARED_CODE_COUNTRY = {
  1: 'US', 7: 'RU', 39: 'IT', 44: 'GB', 47: 'NO', 61: 'AU', 212: 'MA', 262: 'RE', 358: 'FI', 590: 'GP', 599: 'CW',
};
// Shown first in the country list.
export const COMMON_COUNTRIES = ['IN', 'AE', 'SA', 'QA', 'OM', 'KW', 'BH', 'US', 'GB', 'CA', 'AU', 'SG', 'NP'];
// </countries>

export const COUNTRIES = COUNTRY_ROWS.map(([iso, name, dial, min, max, keepZero = false]) => ({
  iso, name, dial, min, max, keepZero,
}));
const BY_ISO = new Map(COUNTRIES.map((c) => [c.iso, c]));
const BY_CODE = new Map();
for (const c of COUNTRIES) {
  if (!BY_CODE.has(c.dial) || SHARED_CODE_COUNTRY[c.dial] === c.iso) BY_CODE.set(c.dial, c);
}
const INDIA = BY_ISO.get('IN');

export const countryByIso = (iso) => BY_ISO.get(String(iso || '').toUpperCase()) || null;

/** The country a number's digits start with ("971501234567" → United Arab Emirates). */
export const countryForDigits = (digits) => {
  const d = String(digits || '');
  for (let size = Math.min(3, d.length); size >= 1; size -= 1) {
    const country = BY_CODE.get(d.slice(0, size));
    if (country) return country;
  }
  return null;
};

/** The number after the country code without what is dialled only at home: "0501234567" → "501234567". */
const withoutHomePrefix = (country, digits) => {
  if (country.dial === '1' && digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (country.dial === '7' && digits.length === 11 && digits.startsWith('8')) return digits.slice(1);
  if (!country.keepZero && digits.startsWith('0')) return digits.slice(1);
  return digits;
};

/**
 * Reads a phone number as typed or stored: { country, number } (number is
 * the digits after the country code), or null if it isn't a phone number.
 */
export const parsePhone = (value) => {
  const compact = String(value ?? '').trim().replace(/[\s().-]/g, '');
  if (!/^\+?\d+$/.test(compact)) return null;
  let digits = compact.replace('+', '');
  let international = compact.startsWith('+');
  if (!international && digits.length > 10 && digits.startsWith('00')) {
    international = true;
    digits = digits.slice(2);
  }
  if (!international) {
    // No country code: an Indian number ("9876543210", "09876543210", "919876543210").
    if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
    else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    return { country: INDIA, number: digits };
  }
  const country = countryForDigits(digits);
  if (!country) return null;
  return { country, number: withoutHomePrefix(country, digits.slice(country.dial.length)) };
};

const rightLength = ({ country, number }) => /^\d+$/.test(number)
  && number.length >= country.min && number.length <= country.max
  && country.dial.length + number.length <= 15;

const lengthText = (c) => (c.min === c.max ? `${c.min} digits` : `${c.min}–${c.max} digits`);

/** What is wrong with a phone number, in words ("Phone number must be …"); null when it is fine. */
export const phoneProblem = (value, label = 'Phone number') => {
  if (!String(value ?? '').trim()) return `${label} is required`;
  const parsed = parsePhone(value);
  if (!parsed) return `Enter a valid ${label.toLowerCase()}`;
  if (rightLength(parsed)) return null;
  const { country } = parsed;
  if (country === INDIA) {
    return parsed.number.length > 10
      ? `${label} must be exactly 10 digits, or start with + and the country code`
      : `${label} must be exactly 10 digits`;
  }
  return `${label} must have ${lengthText(country)} after +${country.dial} (${country.name})`;
};

export const isValidPhone = (value) => phoneProblem(value) === null;

/** The number as it is stored: "9876543210" for India, "+971501234567" for anywhere else; null if not valid. */
export const normalizePhone = (value) => {
  const parsed = parsePhone(value);
  if (!parsed || !rightLength(parsed)) return null;
  return parsed.country === INDIA ? parsed.number : `+${parsed.country.dial}${parsed.number}`;
};

/** Do two numbers mean the same phone? ("98765 43210" and "+91 9876543210" do.) */
export const samePhone = (a, b) => {
  const x = normalizePhone(a);
  const y = normalizePhone(b);
  if (x && y) return x === y;
  return String(a ?? '').replace(/\D/g, '') === String(b ?? '').replace(/\D/g, '');
};

/**
 * The number WhatsApp sends to: country code and number, digits only
 * ("919876543210", "971501234567"); null if it can't be a mobile. An Indian
 * mobile starts with 6–9.
 */
export const whatsappNumber = (value) => {
  const parsed = parsePhone(value);
  if (!parsed || !rightLength(parsed)) return null;
  if (parsed.country === INDIA && !/^[6-9]/.test(parsed.number)) return null;
  return `${parsed.country.dial}${parsed.number}`;
};

// ── For the country picker (components/ui/PhoneInput.jsx) ──────────────────

const byName = (a, b) => a.name.localeCompare(b.name, 'en');

/** The picker's list: the most used countries first, then every country A–Z. */
export const COUNTRY_GROUPS = [
  { label: 'Most used', countries: COMMON_COUNTRIES.map((iso) => BY_ISO.get(iso)) },
  { label: 'All countries', countries: [...COUNTRIES].sort(byName) },
];

/**
 * A stored number split for the picker: { iso, number }. Keeps the country
 * already chosen when it has the same country code (the US and Canada share
 * +1). A number that can't be read shows its digits under India.
 */
export const splitPhone = (value, preferIso = 'IN') => {
  const preferred = countryByIso(preferIso) || INDIA;
  if (!String(value ?? '').trim()) return { iso: preferred.iso, number: '' };
  const parsed = parsePhone(value);
  if (!parsed) return { iso: INDIA.iso, number: String(value).replace(/\D/g, '') };
  return { iso: parsed.country.dial === preferred.dial ? preferred.iso : parsed.country.iso, number: parsed.number };
};

/**
 * The picker's country and the digits typed, as the number is kept:
 * "9876543210" for India, "+971501234567" for anywhere else (a 0 dialled at
 * home is dropped); '' when nothing is typed.
 */
export const composePhone = (iso, typed) => {
  const country = countryByIso(iso) || INDIA;
  const digits = String(typed ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (country === INDIA) return digits;
  return `+${country.dial}${withoutHomePrefix(country, digits)}`;
};
