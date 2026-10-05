/** Conventional Commits, enforced (BUILD_PLAN §2.3). */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      1,
      'always',
      [
        'domain',
        'ledger',
        'contracts',
        'adapters',
        'api',
        'web',
        'admin',
        'ui',
        'infra',
        'docs',
        'ci',
        'deps',
      ],
    ],
    'body-max-line-length': [0, 'always'],
  },
};
