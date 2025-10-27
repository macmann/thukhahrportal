import mongoose, { Mongoose } from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/brillarhrportal';

declare global {
  // eslint-disable-next-line no-var
  var mongooseConnection: {
    conn: Mongoose | null;
    promise: Promise<Mongoose> | null;
  } | undefined;
}

if (!MONGODB_URI) {
  throw new Error('MONGODB_URI must be provided');
}

let cached = global.mongooseConnection;

if (!cached) {
  cached = global.mongooseConnection = { conn: null, promise: null };
}

export async function connectToDatabase(): Promise<Mongoose> {
  if (cached?.conn) {
    return cached.conn;
  }

  if (!cached?.promise) {
    mongoose.set('strictQuery', true);
    cached!.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
      maxPoolSize: 10
    });
  }

  cached!.conn = await cached!.promise;
  return cached!.conn;
}
