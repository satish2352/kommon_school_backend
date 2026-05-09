'use strict';

const Joi = require('joi');

const createOrderSchema = Joi.object({
  enrollmentId: Joi.string().uuid().required(),
});

const verifyPaymentSchema = Joi.object({
  razorpay_order_id: Joi.string().required(),
  razorpay_payment_id: Joi.string().required(),
  razorpay_signature: Joi.string().required(),
});

module.exports = { createOrderSchema, verifyPaymentSchema };
