<script lang="ts">
	import type { DeviceInfo } from '$lib/utils/devices';

	let {
		label = '',
		devices = [],
		selected = '',
		onSelect
	}: {
		label?: string;
		devices?: DeviceInfo[];
		selected?: string;
		onSelect: (deviceId: string) => void;
	} = $props();
</script>

{#if devices.length > 0}
	<div class="space-y-1">
		<label class="text-text-muted text-xs font-medium uppercase tracking-wider">{label}</label>
		<select
			value={selected}
			onchange={(e) => onSelect(e.currentTarget.value)}
			class="bg-surface text-text-primary w-full cursor-pointer appearance-none rounded-xl border border-white/5 px-3 py-2 text-sm outline-none transition-colors hover:border-white/10 focus:border-accent"
		>
			{#each devices as device (device.deviceId)}
				<option value={device.deviceId}>{device.label}</option>
			{/each}
		</select>
	</div>
{/if}
