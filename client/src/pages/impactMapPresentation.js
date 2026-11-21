function groupEvidenceQuotes(items, getEvidence, getPageNumber) {
  const grouped = new Map();

  for (const item of items) {
    const evidence = getEvidence(item);
    const key = typeof evidence === 'string' ? evidence : '';
    let quote = grouped.get(key);
    if (!quote) {
      quote = { evidence: key, pageNumbers: [] };
      grouped.set(key, quote);
    }

    const pageNumber = getPageNumber(item);
    if (Number.isInteger(pageNumber) && !quote.pageNumbers.includes(pageNumber)) {
      quote.pageNumbers.push(pageNumber);
    }
  }

  return [...grouped.values()];
}

export function groupImpactNotices(notices, selectedDistrictId) {
  const grouped = new Map();

  notices.forEach((notice, index) => {
    const districtId = notice.districtId ?? selectedDistrictId;
    const noticeId = notice.noticeId == null ? null : String(notice.noticeId).trim().toLowerCase();
    const key = noticeId && districtId
      ? JSON.stringify([districtId, noticeId])
      : `entry:${index}`;
    let entry = grouped.get(key);
    if (!entry) {
      entry = {
        ...notice,
        districtId,
        noticeId,
        impactStatuses: [],
        matches: [],
        unresolvedLocations: [],
      };
      grouped.set(key, entry);
    }

    const statuses = notice.impactStatuses ?? [notice.impactStatus];
    for (const status of statuses) {
      if (status && !entry.impactStatuses.includes(status)) entry.impactStatuses.push(status);
    }
    entry.matches.push(...(notice.matches ?? []));
    entry.unresolvedLocations.push(...(notice.unresolvedLocations ?? []));
  });

  return [...grouped.values()].map((notice) => ({
    ...notice,
    matches: groupEvidenceQuotes(
      notice.matches,
      (match) => match.evidence,
      (match) => match.pageNumber,
    ),
    unresolvedLocations: groupEvidenceQuotes(
      notice.unresolvedLocations,
      (item) => item.location?.evidence,
      (item) => item.location?.pageNumber,
    ),
  }));
}
