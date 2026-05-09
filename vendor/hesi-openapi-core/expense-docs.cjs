const TYPE_LABELS = {
  expense: '报销单',
  requisition: '申请单',
  loan: '借款单',
  payment: '付款单'
};

const STATE_LABELS = {
  approving: '审批中',
  approved: '已通过',
  rejected: '已驳回',
  canceled: '已撤销',
  paid: '已支付',
  closed: '已关闭'
};

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function sanitizeStaff(staff) {
  return {
    id: staff.id,
    name: staff.name || '',
    active: Boolean(staff.active),
    authState: Boolean(staff.authState),
    external: Boolean(staff.external)
  };
}

function matchesIdentity(staff, input) {
  const staffId = normalizeText(input.staffId || input.id);
  const userId = normalizeText(input.userId);
  const name = normalizeText(input.name);
  const email = normalizeText(input.email);
  const fullPhone = normalizeDigits(input.cellphone || input.phone);
  const phoneLast4 = normalizeDigits(input.phoneLast4);

  if (staffId && normalizeText(staff.id) !== staffId) return false;
  if (userId && normalizeText(staff.userId) !== userId) return false;
  if (name && normalizeText(staff.name) !== name) return false;

  if (email) {
    const staffEmails = [staff.email, staff.showEmail].map(normalizeText).filter(Boolean);
    if (!staffEmails.includes(email)) return false;
  }

  const staffPhone = normalizeDigits(staff.cellphone);
  if (fullPhone && staffPhone !== fullPhone) return false;
  if (phoneLast4 && !staffPhone.endsWith(phoneLast4)) return false;

  return true;
}

function formatDate(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return '';

  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value));
}

function moneyText(money) {
  if (!money || money.standard === undefined || money.standard === null || money.standard === '') {
    return '';
  }
  return `${money.standard}${money.standardUnit || ''}`;
}

function moneyValue(money) {
  if (!money || money.standard === undefined || money.standard === null || money.standard === '') {
    return null;
  }

  const value = Number(money.standard);
  return Number.isFinite(value) ? value : null;
}

function moneyUnit(money) {
  return money && money.standardUnit ? String(money.standardUnit) : '';
}

function sanitizeDoc(doc) {
  const form = doc.form || {};
  const amount = form.expenseMoney || form.payMoney || form.applyMoney || form.money;

  return {
    code: form.code || '',
    title: form.title || '',
    type: TYPE_LABELS[doc.formType] || doc.formType || '',
    state: STATE_LABELS[doc.state] || doc.state || '',
    amount: moneyText(amount),
    submitTime: formatDate(form.submitDate),
    updateTime: formatDate(doc.updateTime),
    rejectionCount: form.rejectionNum || '0',
    voucherStatus: form.voucherStatus || ''
  };
}

function docTimestamp(doc) {
  const form = doc.form || {};
  const values = [doc.updateTime, form.submitDate].map(Number).filter((value) => Number.isFinite(value));
  return values.length ? Math.max(...values) : 0;
}

function summarizeDocs(docs) {
  const items = Array.isArray(docs.items) ? docs.items : [];
  const summary = {
    total: docs.count || items.length,
    returned: items.length,
    byState: {},
    byType: {},
    amountByUnit: {},
    rejectedCount: 0,
    latestItems: items
      .slice()
      .sort((left, right) => docTimestamp(right) - docTimestamp(left))
      .slice(0, 5)
      .map(sanitizeDoc)
  };

  for (const doc of items) {
    const form = doc.form || {};
    const state = STATE_LABELS[doc.state] || doc.state || '未知状态';
    const type = TYPE_LABELS[doc.formType] || doc.formType || '未知类型';
    const amount = form.expenseMoney || form.payMoney || form.applyMoney || form.money;
    const value = moneyValue(amount);
    const unit = moneyUnit(amount) || '未标明币种';

    summary.byState[state] = (summary.byState[state] || 0) + 1;
    summary.byType[type] = (summary.byType[type] || 0) + 1;

    if (value !== null) {
      summary.amountByUnit[unit] = Number(((summary.amountByUnit[unit] || 0) + value).toFixed(2));
    }

    if (doc.state === 'rejected' || Number(form.rejectionNum || 0) > 0) {
      summary.rejectedCount += 1;
    }
  }

  return summary;
}

function clampCount(value) {
  const count = Number(value || 10);
  if (!Number.isFinite(count) || count <= 0) return 10;
  return Math.min(Math.floor(count), 100);
}

module.exports = {
  STATE_LABELS,
  TYPE_LABELS,
  clampCount,
  matchesIdentity,
  sanitizeDoc,
  sanitizeStaff,
  summarizeDocs
};
