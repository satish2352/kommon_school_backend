'use strict';

/**
 * Reusable email service barrel.
 *
 * Usage from app code:
 *   const { sendOnboardingEmail } = require('../../../scripts/email');
 */

const { getTransport, verifyTransport, isMailEnabled, getFromAddress } = require('./mailer');
const { sendOnboardingEmail } = require('./sendOnboardingEmail');
const { buildOnboardingEmail } = require('./templates/onboardingEmail');

module.exports = {
  getTransport,
  verifyTransport,
  isMailEnabled,
  getFromAddress,
  sendOnboardingEmail,
  buildOnboardingEmail,
};
