import { z } from 'zod';

export const performanceReviewSchema = z
  .object({
    employeeId: z.string().trim().min(3, 'Employee ID must be at least 3 characters'),
    reviewerId: z.string().trim().min(3, 'Reviewer ID must be at least 3 characters'),
    reviewPeriodStart: z.string().datetime(),
    reviewPeriodEnd: z.string().datetime(),
    overallRating: z.enum(['outstanding', 'exceeds', 'meets', 'progressing', 'unsatisfactory']),
    strengths: z.string().trim().min(10, 'Highlight at least one key strength'),
    opportunities: z.string().trim().min(10, 'Include at least one development opportunity'),
    goals: z
      .array(z.string().trim().min(3, 'Goals must contain meaningful statements'))
      .max(10, 'Limit to 10 active goals')
      .default([]),
    status: z.enum(['draft', 'shared', 'acknowledged']).default('draft')
  })
  .refine(
    data => new Date(data.reviewPeriodEnd).getTime() >= new Date(data.reviewPeriodStart).getTime(),
    {
      message: 'Review end date cannot be before the start date',
      path: ['reviewPeriodEnd']
    }
  );

export type PerformanceReviewInput = z.infer<typeof performanceReviewSchema>;
