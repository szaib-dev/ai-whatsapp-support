import 'dotenv/config';
import {configurationIssues} from '../dist/config.js';
const errors=configurationIssues({...process.env,NODE_ENV:'production'});
if(errors.length){for(const error of errors)console.error(`BLOCKER: ${error}`);process.exitCode=1;}
else console.log('Production configuration checks passed. DNS, HTTPS, restore drills, provider terms and Google approval still require external verification.');
