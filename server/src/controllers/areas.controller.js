import { User } from '../models/User.js';
import { Notice } from '../models/Notice.js';
import { ProcessingJob } from '../models/ProcessingJob.js';
import {
  andhraPradeshDistricts,
  areaRegistrySource,
  matchNoticeLocations,
} from '../services/areaMatching.service.js';

export function getAreas(_req, res) {
  return res.json({
    areas: andhraPradeshDistricts.map(({ id, name, stateCode, level, aliases, sourceMetadata }) => ({
      id,
      name,
      stateCode,
      level,
      aliases,
      ...(sourceMetadata ? { sourceMetadata } : {}),
    })),
    source: areaRegistrySource,
    geometryAvailable: false,
  });
}

export async function getAreaImpact(req, res, next) {
  try {
    const area = andhraPradeshDistricts.find(({ id }) => id === req.params.id);
    if (!area) {
      return res.status(404).json({
        error: { code: 'AREA_NOT_FOUND', message: 'Supported district not found.' },
      });
    }

    const user = await User.findById(req.auth.userId).select('selectedAreaIds').lean();
    if (!user) {
      return res.status(401).json({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication is required.' },
      });
    }
    if (!user.selectedAreaIds.includes(area.id)) {
      return res.status(403).json({
        error: { code: 'AREA_NOT_SELECTED', message: 'Select this district to view its notice impact.' },
      });
    }

    const notices = await Notice.find({ ownerId: req.auth.userId })
      .select('_id originalFile.filename status createdAt')
      .sort({ createdAt: -1 })
      .lean();
    const noticeIds = notices.map(({ _id }) => _id);
    const jobs = noticeIds.length === 0
      ? []
      : await ProcessingJob.find({ ownerId: req.auth.userId, noticeId: { $in: noticeIds } })
        .select('noticeId status analysisStatus +analysis')
        .lean();
    const jobsByNoticeId = new Map(jobs.map((job) => [String(job.noticeId), job]));

    return res.json({
      area: { id: area.id, name: area.name, level: area.level },
      notices: notices.map((notice) => {
        const job = jobsByNoticeId.get(String(notice._id));
        if (job?.analysisStatus !== 'completed' || !job.analysis) {
          return {
            noticeId: String(notice._id),
            districtId: area.id,
            filename: notice.originalFile.filename,
            createdAt: notice.createdAt,
            impactStatus: 'unknown',
            impactStatuses: ['unknown'],
            matches: [],
            unresolvedLocations: [],
          };
        }

        const matched = matchNoticeLocations(job.analysis.locations ?? [], [area.id]);
        const matches = matched.matches;
        const unresolvedLocations = matched.unresolved;
        const impactStatuses = [];
        if (matches.length > 0) impactStatuses.push('district_mentioned');
        if (unresolvedLocations.length > 0) impactStatuses.push('unresolved');
        if (impactStatuses.length === 0) impactStatuses.push('not_explicitly_listed');
        return {
          noticeId: String(notice._id),
          districtId: area.id,
          filename: notice.originalFile.filename,
          createdAt: notice.createdAt,
          impactStatus: impactStatuses[0],
          impactStatuses,
          matches,
          unresolvedLocations,
        };
      }),
    });
  } catch (error) {
    return next(error);
  }
}
