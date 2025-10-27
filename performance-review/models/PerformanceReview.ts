import { Schema, model, models } from 'mongoose';
import type { ReviewRating, ReviewStatus } from '@/lib/types';

export interface PerformanceReviewDocument {
  employeeId: string;
  reviewerId: string;
  reviewPeriodStart: Date;
  reviewPeriodEnd: Date;
  overallRating: ReviewRating;
  strengths: string;
  opportunities: string;
  goals: string[];
  status: ReviewStatus;
  createdAt: Date;
  updatedAt: Date;
}

const performanceReviewSchema = new Schema<PerformanceReviewDocument>(
  {
    employeeId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    reviewerId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    reviewPeriodStart: {
      type: Date,
      required: true
    },
    reviewPeriodEnd: {
      type: Date,
      required: true
    },
    overallRating: {
      type: String,
      enum: ['outstanding', 'exceeds', 'meets', 'progressing', 'unsatisfactory'],
      required: true
    },
    strengths: {
      type: String,
      required: true,
      trim: true
    },
    opportunities: {
      type: String,
      required: true,
      trim: true
    },
    goals: {
      type: [String],
      default: [],
      validate: {
        validator: (value: string[]) =>
          value.every(item => typeof item === 'string' && item.trim().length > 0),
        message: 'Goals must contain non-empty strings'
      }
    },
    status: {
      type: String,
      enum: ['draft', 'shared', 'acknowledged'],
      default: 'draft',
      index: true
    }
  },
  {
    timestamps: true
  }
);

export const PerformanceReviewModel =
  models.PerformanceReview || model('PerformanceReview', performanceReviewSchema);
