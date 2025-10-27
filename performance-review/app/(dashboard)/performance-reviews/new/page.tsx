'use client';

import { useMemo, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { performanceReviewSchema } from '@/lib/validation';
import type { ReviewRating, ReviewStatus } from '@/lib/types';

const ratings: { value: ReviewRating; label: string }[] = [
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'exceeds', label: 'Exceeds Expectations' },
  { value: 'meets', label: 'Meets Expectations' },
  { value: 'progressing', label: 'Progressing' },
  { value: 'unsatisfactory', label: 'Unsatisfactory' }
];

const statuses: { value: ReviewStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'shared', label: 'Shared with employee' },
  { value: 'acknowledged', label: 'Acknowledged' }
];

export default function NewPerformanceReviewPage() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formState, setFormState] = useState({
    employeeId: '',
    reviewerId: '',
    reviewPeriodStart: '',
    reviewPeriodEnd: '',
    overallRating: 'meets' as ReviewRating,
    strengths: '',
    opportunities: '',
    goals: '',
    status: 'draft' as ReviewStatus
  });

  const goalsArray = useMemo(
    () =>
      formState.goals
        .split('\n')
        .map(goal => goal.trim())
        .filter(Boolean),
    [formState.goals]
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    try {
      const startDate = new Date(formState.reviewPeriodStart);
      const endDate = new Date(formState.reviewPeriodEnd);

      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        throw new Error('Provide a valid review period.');
      }

      const payload = {
        employeeId: formState.employeeId.trim(),
        reviewerId: formState.reviewerId.trim(),
        reviewPeriodStart: startDate.toISOString(),
        reviewPeriodEnd: endDate.toISOString(),
        overallRating: formState.overallRating,
        strengths: formState.strengths.trim(),
        opportunities: formState.opportunities.trim(),
        goals: goalsArray,
        status: formState.status
      };

      performanceReviewSchema.parse(payload);

      const response = await fetch('/api/performance-reviews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create review');
      }

      router.push('/performance-reviews');
      router.refresh();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to create review');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => router.back()}
        className="text-sm font-medium text-brand-600 hover:text-brand-700"
      >
        &larr; Back
      </button>

      <form onSubmit={handleSubmit} className="card space-y-6">
        <header>
          <h2 className="text-2xl font-semibold text-slate-900">Create performance review</h2>
          <p className="mt-2 text-sm text-slate-600">
            Document the review period, recognise impact, and set measurable goals.
          </p>
        </header>

        {formError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</p>}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Employee ID
            <input
              required
              value={formState.employeeId}
              onChange={event => setFormState(state => ({ ...state, employeeId: event.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Reviewer ID
            <input
              required
              value={formState.reviewerId}
              onChange={event => setFormState(state => ({ ...state, reviewerId: event.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Review start
            <input
              type="date"
              required
              value={formState.reviewPeriodStart}
              onChange={event => setFormState(state => ({ ...state, reviewPeriodStart: event.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Review end
            <input
              type="date"
              required
              value={formState.reviewPeriodEnd}
              onChange={event => setFormState(state => ({ ...state, reviewPeriodEnd: event.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </label>
        </div>

        <label className="space-y-2 text-sm font-medium text-slate-700">
          Overall rating
          <select
            value={formState.overallRating}
            onChange={event =>
              setFormState(state => ({ ...state, overallRating: event.target.value as ReviewRating }))
            }
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          >
            {ratings.map(rating => (
              <option key={rating.value} value={rating.value}>
                {rating.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-700">
          Strengths
          <textarea
            required
            rows={4}
            value={formState.strengths}
            onChange={event => setFormState(state => ({ ...state, strengths: event.target.value }))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-700">
          Development opportunities
          <textarea
            required
            rows={4}
            value={formState.opportunities}
            onChange={event => setFormState(state => ({ ...state, opportunities: event.target.value }))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-700">
          Goals (one per line)
          <textarea
            rows={4}
            value={formState.goals}
            onChange={event => setFormState(state => ({ ...state, goals: event.target.value }))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
            placeholder={'Launch Q3 product update\nReduce customer churn below 4%'}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-700">
          Status
          <select
            value={formState.status}
            onChange={event =>
              setFormState(state => ({ ...state, status: event.target.value as ReviewStatus }))
            }
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          >
            {statuses.map(status => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            onClick={() => router.push('/performance-reviews')}
          >
            Cancel
          </button>
          <button type="submit" className="button-primary" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save review'}
          </button>
        </div>
      </form>
    </div>
  );
}
