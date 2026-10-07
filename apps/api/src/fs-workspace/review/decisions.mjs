// Records arrive oldest first. A later reject must not expose an earlier approve.
export function approvalProjection(records, binding) {
  const latest = new Map(records.map((record) => [record.role, record]));
  const approved = (role) => {
    const record = latest.get(role);
    return Boolean(
      record?.action === 'approve' &&
      Object.entries(binding).every(([key, value]) => record[key] === value),
    );
  };
  return {
    technical_approved: approved('technical_reviewer'),
    business_approved: approved('business_approver'),
  };
}
