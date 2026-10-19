import 'dotenv/config';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { removeSamples, seedSamples } from '../services/sampleData.js';

const remove = process.argv.includes('--remove');
await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
if (remove) console.log(`Removed ${await removeSamples()} sample records.`);
else console.log(`Created ${await seedSamples()} SAMPLE records (isSample=true). They are shown separately in the placement dashboard and never mixed with real analyses.`);
await mongoose.disconnect();
