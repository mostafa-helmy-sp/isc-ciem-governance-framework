export function calculateTimeDifference(startTime: number, endTime: number): string {
    const timeDiff: number = endTime - startTime
    const totalSeconds = Math.floor(timeDiff / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const totalHours = Math.floor(totalMinutes / 60);
    const remSeconds = totalSeconds % 60;
    const remMinutes = totalMinutes % 60;

    return `${totalHours > 0 ? `${totalHours}h` : ''}${remMinutes > 0 ? `${remMinutes}m` : ''}${remSeconds}s`
}