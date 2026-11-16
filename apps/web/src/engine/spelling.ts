// The spelling dictionary SPELL checks with (M4-09 part 4): Hunspell's en_US from SCOWL
// (`assets/dictionaries/en-US`, ATTRIBUTION.md), built into the app so it works offline and
// nothing is fetched. Imported only when SPELL first runs, so its half megabyte stays out of
// the engine worker's start.
import { hunspellChecker } from '@triya/text';
import aff from '../../../../assets/dictionaries/en-US/en_US.aff?raw';
import dic from '../../../../assets/dictionaries/en-US/en_US.dic?raw';

export const checker = () => hunspellChecker({ name: 'American English', aff, dic });
