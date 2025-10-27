import { NextResponse } from 'next/server';
import {
  createPerformanceReview,
  listPerformanceReviews
} from '@/lib/performanceReviews';
import { ZodError } from 'zod';

export async function GET() {
  try {
    const reviews = await listPerformanceReviews();
    return NextResponse.json({ reviews });
  } catch (error) {
    console.error('Failed to fetch performance reviews', error);
    return NextResponse.json({ error: 'Unable to load performance reviews' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const review = await createPerformanceReview(body);
    return NextResponse.json(review, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues }, { status: 422 });
    }

    console.error('Failed to create performance review', error);
    return NextResponse.json({ error: 'Unable to create performance review' }, { status: 500 });
  }
}
