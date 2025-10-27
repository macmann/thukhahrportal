"use server";

import { Types } from 'mongoose';
import { connectToDatabase } from './mongoose';
import { PerformanceReviewModel } from '@/models/PerformanceReview';
import type { PerformanceReviewDocument } from '@/models/PerformanceReview';
import { performanceReviewSchema, type PerformanceReviewInput } from './validation';
import type { PerformanceReviewDTO } from './types';

type LeanPerformanceReview = PerformanceReviewDocument & { _id: Types.ObjectId };

function mapToDTO(document: LeanPerformanceReview): PerformanceReviewDTO {
  return {
    id: document._id.toString(),
    employeeId: document.employeeId,
    reviewerId: document.reviewerId,
    reviewPeriodStart: document.reviewPeriodStart.toISOString(),
    reviewPeriodEnd: document.reviewPeriodEnd.toISOString(),
    overallRating: document.overallRating,
    strengths: document.strengths,
    opportunities: document.opportunities,
    goals: Array.isArray(document.goals) ? document.goals : [],
    status: document.status,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString()
  };
}

export async function listPerformanceReviews(): Promise<PerformanceReviewDTO[]> {
  await connectToDatabase();
  const reviews = await PerformanceReviewModel.find()
    .sort({ updatedAt: -1 })
    .lean<LeanPerformanceReview[]>();

  return reviews.map(mapToDTO);
}

export async function getPerformanceReview(id: string): Promise<PerformanceReviewDTO | null> {
  if (!Types.ObjectId.isValid(id)) {
    return null;
  }

  await connectToDatabase();
  const review = await PerformanceReviewModel.findById(id).lean<LeanPerformanceReview | null>();
  return review ? mapToDTO(review) : null;
}

export async function createPerformanceReview(input: PerformanceReviewInput): Promise<PerformanceReviewDTO> {
  const payload = performanceReviewSchema.parse(input);
  await connectToDatabase();
  const review = await PerformanceReviewModel.create({
    ...payload,
    reviewPeriodStart: new Date(payload.reviewPeriodStart),
    reviewPeriodEnd: new Date(payload.reviewPeriodEnd)
  });
  return mapToDTO(review.toObject() as LeanPerformanceReview);
}

export async function updatePerformanceReview(
  id: string,
  input: Partial<PerformanceReviewInput>
): Promise<PerformanceReviewDTO | null> {
  if (!Types.ObjectId.isValid(id)) {
    return null;
  }

  const payload = performanceReviewSchema.partial().parse(input);
  await connectToDatabase();
  const review = await PerformanceReviewModel.findByIdAndUpdate(
    id,
    {
      ...payload,
      ...(payload.reviewPeriodStart ? { reviewPeriodStart: new Date(payload.reviewPeriodStart) } : {}),
      ...(payload.reviewPeriodEnd ? { reviewPeriodEnd: new Date(payload.reviewPeriodEnd) } : {})
    },
    {
      new: true,
      runValidators: true
    }
  ).lean<LeanPerformanceReview | null>();

  return review ? mapToDTO(review) : null;
}
