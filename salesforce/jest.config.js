const { jestConfig } = require('@salesforce/sfdx-lwc-jest/config');

/**
 * The tests live in test/lwc rather than in __tests__ folders inside each
 * bundle. This repo deploys with `sf project deploy start --metadata-dir`,
 * which zips force-app as it stands - a __tests__ folder inside a bundle would
 * go to the org with it. Keeping them outside force-app means the deploy needs
 * no .forceignore to stay clean.
 */
module.exports = {
    ...jestConfig,
    testMatch: ['<rootDir>/test/lwc/**/*.test.js'],
    // cafTheme is a CSS-only module (@import 'c/cafTheme'). The platform finds
    // its .css; Jest's resolver looks for a .js and needs pointing at it.
    moduleNameMapper: {
        ...(jestConfig.moduleNameMapper || {}),
        '^c/cafTheme$': '<rootDir>/force-app/lwc/cafTheme/cafTheme.css'
    },
    modulePathIgnorePatterns: ['<rootDir>/.localdevserver']
};
