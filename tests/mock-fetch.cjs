const staffs = [
  {
    id: 'staff:001',
    userId: 'user-001',
    name: '张三',
    email: 'zhangsan@example.com',
    showEmail: 'zhangsan@example.com',
    cellphone: '13800001234',
    active: true,
    authState: true,
    external: false
  },
  {
    id: 'staff:002',
    userId: 'user-002',
    name: '李四',
    email: 'lisi@example.com',
    showEmail: 'lisi@example.com',
    cellphone: '13900005678',
    active: true,
    authState: true,
    external: false
  }
];

const docsByStaff = {
  'staff:001': [
    {
      formType: 'expense',
      state: 'approved',
      updateTime: 1735952400000,
      form: {
        code: 'BX-001',
        title: '上海差旅报销',
        expenseMoney: { standard: 1200.5, standardUnit: 'CNY' },
        submitDate: 1735866000000,
        rejectionNum: 0,
        voucherStatus: 'done'
      }
    },
    {
      formType: 'loan',
      state: 'rejected',
      updateTime: 1736125200000,
      form: {
        code: 'JK-002',
        title: '备用金借款',
        money: { standard: 500, standardUnit: 'CNY' },
        submitDate: 1736038800000,
        rejectionNum: 1,
        voucherStatus: ''
      }
    },
    {
      formType: 'payment',
      state: 'approving',
      updateTime: 1736211600000,
      form: {
        code: 'FK-003',
        title: '供应商付款',
        payMoney: { standard: 300, standardUnit: 'CNY' },
        submitDate: 1736211600000,
        rejectionNum: 0,
        voucherStatus: ''
      }
    }
  ],
  'staff:002': []
};

function mockResponse(status, body) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Mock Error',
    async json() {
      return JSON.parse(text);
    },
    async text() {
      return text;
    }
  };
}

function parsePage(searchParams) {
  const start = Number(searchParams.get('start') || 0);
  const count = Number(searchParams.get('count') || 100);
  return {
    start: Number.isFinite(start) && start >= 0 ? start : 0,
    count: Number.isFinite(count) && count > 0 ? count : 100
  };
}

global.fetch = async function mockFetch(input, init = {}) {
  const url = new URL(String(input));
  const method = String(init.method || 'GET').toUpperCase();

  if (method === 'POST' && url.pathname === '/api/openapi/v2/auth/getAccessToken') {
    return mockResponse(200, {
      value: {
        accessToken: 'mock-token',
        expiresIn: 3600
      }
    });
  }

  if (method === 'GET' && url.pathname === '/api/openapi/v2/staffs') {
    const page = parsePage(url.searchParams);
    return mockResponse(200, {
      count: staffs.length,
      items: staffs.slice(page.start, page.start + page.count)
    });
  }

  const match = url.pathname.match(/^\/api\/openapi\/v1\.1\/docs\/byFlowId\/\$(.+)$/);
  if (method === 'GET' && match) {
    const staffId = decodeURIComponent(match[1]);
    const docs = docsByStaff[staffId] || [];
    const page = parsePage(url.searchParams);
    return mockResponse(200, {
      count: docs.length,
      items: docs.slice(page.start, page.start + page.count)
    });
  }

  return mockResponse(404, {
    errorCode: 404,
    errorMessage: `No mock route for ${method} ${url.pathname}`
  });
};
