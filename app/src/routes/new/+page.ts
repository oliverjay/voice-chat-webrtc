import { redirect } from '@sveltejs/kit';
import { generateRoomId } from '$lib/utils/room-id';
import type { PageLoad } from './$types';

export const load: PageLoad = () => {
	throw redirect(302, `/${generateRoomId()}`);
};
