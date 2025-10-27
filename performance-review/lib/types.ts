export type ReviewRating = 'outstanding' | 'exceeds' | 'meets' | 'progressing' | 'unsatisfactory';
export type ReviewStatus = 'draft' | 'shared' | 'acknowledged';

export interface PerformanceReviewDTO {
  id: string;
  employeeId: string;
  reviewerId: string;
  reviewPeriodStart: string;
  reviewPeriodEnd: string;
  overallRating: ReviewRating;
  strengths: string;
  opportunities: string;
  goals: string[];
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PerformanceReviewFormData {
  employeeId: string;
  reviewerId: string;
  reviewPeriodStart: string;
  reviewPeriodEnd: string;
  overallRating: ReviewRating;
  strengths: string;
  opportunities: string;
  goals: string[];
  status: ReviewStatus;
}
