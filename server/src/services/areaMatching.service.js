const districts = [
  { id: 'ap-alluri-sitharama-raju', name: 'Alluri Sitharama Raju', aliases: ['Alluri Sitarama Raju'] },
  { id: 'ap-anakapalli', name: 'Anakapalli', aliases: [] },
  { id: 'ap-ananthapuramu', name: 'Ananthapuramu', aliases: ['Anantapuramu', 'Anantapur', 'Ananthapur'] },
  { id: 'ap-annamayya', name: 'Annamayya', aliases: [] },
  { id: 'ap-bapatla', name: 'Bapatla', aliases: [] },
  { id: 'ap-chittoor', name: 'Chittoor', aliases: [] },
  { id: 'ap-dr-br-ambedkar-konaseema', name: 'Dr. B. R. Ambedkar Konaseema', aliases: ['Dr B R Ambedkar Konaseema', 'Dr. B.R. Ambedkar Konaseema', 'Konaseema'] },
  { id: 'ap-east-godavari', name: 'East Godavari', aliases: [] },
  { id: 'ap-eluru', name: 'Eluru', aliases: [] },
  { id: 'ap-guntur', name: 'Guntur', aliases: [] },
  { id: 'ap-kakinada', name: 'Kakinada', aliases: [] },
  { id: 'ap-krishna', name: 'Krishna', aliases: [] },
  { id: 'ap-kurnool', name: 'Kurnool', aliases: [] },
  {
    id: 'ap-markapuram',
    name: 'Markapuram',
    aliases: [],
    sourceMetadata: {
      authority: 'Reserve Bank of India',
      workingCode: '02Y',
      formationOrder: 'G.O.MS.No.524',
      formationOrderDate: '2025-12-30',
      notificationDate: '2026-04-10',
    },
  },
  { id: 'ap-nandyal', name: 'Nandyal', aliases: [] },
  { id: 'ap-ntr', name: 'NTR', aliases: ['NTR district'] },
  { id: 'ap-palnadu', name: 'Palnadu', aliases: [] },
  { id: 'ap-parvathipuram-manyam', name: 'Parvathipuram Manyam', aliases: ['Parvathipuram-Manyam'] },
  {
    id: 'ap-polavaram',
    name: 'Polavaram',
    aliases: [],
    sourceMetadata: {
      authority: 'Reserve Bank of India',
      workingCode: '02X',
      formationOrder: 'G.O.MS.No.517',
      formationOrderDate: '2025-12-30',
      notificationDate: '2026-04-10',
    },
  },
  { id: 'ap-prakasam', name: 'Prakasam', aliases: [] },
  {
    id: 'ap-spsr-nellore',
    name: 'Sri Potti Sriramulu Nellore',
    aliases: ['SPSR Nellore', 'Nellore', 'Nellore district'],
  },
  { id: 'ap-sri-sathya-sai', name: 'Sri Sathya Sai', aliases: ['Sri Satya Sai', 'Sathya Sai district'] },
  { id: 'ap-srikakulam', name: 'Srikakulam', aliases: [] },
  { id: 'ap-tirupati', name: 'Tirupati', aliases: [] },
  { id: 'ap-visakhapatnam', name: 'Visakhapatnam', aliases: [] },
  { id: 'ap-vizianagaram', name: 'Vizianagaram', aliases: [] },
  { id: 'ap-west-godavari', name: 'West Godavari', aliases: [] },
  { id: 'ap-ysr-kadapa', name: 'YSR Kadapa', aliases: ['YSR Kadapa district', 'Cuddapah district'] },
];

export const areaRegistrySource = Object.freeze({
  name: 'Integrated Government Online Directory (IGOD)',
  organization: 'Government of India',
  url: 'https://igod.gov.in/',
  stateName: 'Andhra Pradesh',
  stateCode: '28',
  stateCodeAuthority: 'Local Government Directory (LGD)',
  districtIdScheme: 'Stable CivicSignal application IDs; not LGD district codes',
});

export const andhraPradeshDistricts = Object.freeze(districts.map((district) => Object.freeze({
  ...district,
  aliases: Object.freeze([...district.aliases]),
  ...(district.sourceMetadata
    ? { sourceMetadata: Object.freeze({ ...district.sourceMetadata }) }
    : {}),
  stateCode: areaRegistrySource.stateCode,
  level: 'district',
})));

function normalizeLocation(value) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-IN')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function findExplicitDistricts(evidence) {
  const normalizedEvidence = ` ${normalizeLocation(evidence)} `;
  const matches = [];

  for (const district of andhraPradeshDistricts) {
    const aliases = [district.name, ...district.aliases]
      .map(normalizeLocation)
      .sort((left, right) => right.length - left.length);
    const matchedAlias = aliases.find((alias) => normalizedEvidence.includes(` ${alias} `));
    if (matchedAlias) matches.push({ district, matchedAlias });
  }

  return matches;
}

export function matchNoticeLocations(locations, selectedAreaIds = []) {
  if (!Array.isArray(locations) || !Array.isArray(selectedAreaIds)) {
    throw new TypeError('Locations and selected area IDs must be arrays.');
  }

  const selectedIds = new Set(selectedAreaIds);
  const explicitMatches = [];
  const unresolved = [];

  for (const location of locations) {
    if (
      !location
      || typeof location.value !== 'string'
      || typeof location.evidence !== 'string'
      || !Number.isInteger(location.pageNumber)
    ) {
      unresolved.push({
        status: 'unresolved',
        reason: 'Location evidence is incomplete.',
        location: location ?? null,
      });
      continue;
    }

    const candidates = findExplicitDistricts(location.evidence);
    if (candidates.length === 0) {
      unresolved.push({
        status: 'unresolved',
        reason: 'No supported district name or alias appears in the source evidence.',
        location,
      });
      continue;
    }

    for (const { district, matchedAlias } of candidates) {
      explicitMatches.push({
        areaId: district.id,
        areaName: district.name,
        status: 'explicit_mention',
        isSelected: selectedIds.has(district.id),
        matchedAlias,
        evidence: location.evidence,
        pageNumber: location.pageNumber,
        locationValue: location.value,
      });
    }
  }

  return {
    matches: explicitMatches.filter((match) => match.isSelected),
    otherExplicitDistricts: explicitMatches.filter((match) => !match.isSelected),
    unresolved,
  };
}
