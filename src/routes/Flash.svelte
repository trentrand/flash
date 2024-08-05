<script>
  import { Step, Error, useFastboot } from '$lib/fastboot.svelte'
  import LinearProgress from './LinearProgress.svelte'
  import DeviceState from './DeviceState.svelte'

  import bolt from '$lib/assets/bolt.svg'
  import cable from '$lib/assets/cable.svg'
  import cloudDownload from '$lib/assets/cloud_download.svg'
  import cloudError from '$lib/assets/cloud_error.svg'
  import deviceExclamation from '$lib/assets/device_exclamation_c3.svg'
  import deviceQuestion from '$lib/assets/device_question_c3.svg'
  import done from '$lib/assets/done.svg'
  import exclamation from '$lib/assets/exclamation.svg'
  import frameAlert from '$lib/assets/frame_alert.svg'
  import systemUpdate from '$lib/assets/system_update_c3.svg'

  const steps = {
    [Step.READY]: {
      status: 'Ready',
      description: 'Tap the button above to begin',
      bgColor: 'bg-[#51ff00]',
      icon: bolt,
      iconStyle: '',
    },
    [Step.CONNECTING]: {
      status: 'Waiting for connection',
      description: 'Follow the instructions to connect your device to your computer',
      bgColor: 'bg-yellow-500',
      icon: cable,
    },
    [Step.DOWNLOADING]: {
      status: 'Downloading...',
      bgColor: 'bg-blue-500',
      icon: cloudDownload,
    },
    [Step.UNPACKING]: {
      status: 'Unpacking...',
      bgColor: 'bg-blue-500',
      icon: cloudDownload,
    },
    [Step.FLASHING]: {
      status: 'Flashing device...',
      description: 'Do not unplug your device until the process is complete.',
      bgColor: 'bg-lime-400',
      icon: systemUpdate,
    },
    [Step.ERASING]: {
      status: 'Erasing device...',
      bgColor: 'bg-lime-400',
      icon: systemUpdate,
    },
    [Step.DONE]: {
      status: 'Done',
      description: 'Your device has been updated successfully. You can now unplug the USB cable from your computer. To ' +
        'complete the system reset, follow the instructions on your device.',
      bgColor: 'bg-green-500',
      icon: done,
    },
  }

  const errors = {
    [Error.UNKNOWN]: {
      status: 'Unknown error',
      description: 'An unknown error has occurred. Restart your browser and try again.',
      bgColor: 'bg-red-500',
      icon: exclamation,
    },
    [Error.UNRECOGNIZED_DEVICE]: {
      status: 'Unrecognized device',
      description: 'The device connected to your computer is not supported.',
      bgColor: 'bg-yellow-500',
      icon: deviceQuestion,
    },
    [Error.LOST_CONNECTION]: {
      status: 'Lost connection',
      description: 'The connection to your device was lost. Check that your cables are connected properly and try again.',
      icon: cable,
    },
    [Error.DOWNLOAD_FAILED]: {
      status: 'Download failed',
      description: 'The system image could not be downloaded. Check your internet connection and try again.',
      icon: cloudError,
    },
    [Error.CHECKSUM_MISMATCH]: {
      status: 'Download mismatch',
      description: 'The system image downloaded does not match the expected checksum. Try again.',
      icon: frameAlert,
    },
    [Error.FLASH_FAILED]: {
      status: 'Flash failed',
      description: 'The system image could not be flashed to your device. Try using a different cable, USB port, or ' +
        'computer. If the problem persists, join the #hw-three-3x channel on Discord for help.',
      icon: deviceExclamation,
    },
    [Error.ERASE_FAILED]: {
      status: 'Erase failed',
      description: 'The device could not be erased. Try using a different cable, USB port, or computer. If the problem ' +
        'persists, join the #hw-three-3x channel on Discord for help.',
      icon: deviceExclamation,
    },
    [Error.REQUIREMENTS_NOT_MET]: {
      status: 'Requirements not met',
      description: 'Your system does not meet the requirements to flash your device. Make sure to use a browser which ' +
        'supports WebUSB and is up to date.',
    },
  }

  function beforeUnloadListener(event) {
    // NOTE: not all browsers will show this message
    event.preventDefault()
    return (event.returnValue = "Flash in progress. Are you sure you want to leave?")
  }

  const {
    step,
    message,
    progress,
    error,
    onContinue,
    onRetry,
    connected,
    serial,
  } = useFastboot()

  const handleRetry = () => {
    onRetry?.()
  }
 
  const uiState = steps[step]
  if (error) {
    Object.assign(uiState, errors[Error.UNKNOWN], errors[error])
  }
  const { status, description, bgColor, icon, iconStyle = 'invert' } = uiState

  let title = $derived.by(() => {
    if (message && !error) {
      let title = message + '...';
      if (progress >= 0) {
        title += ` (${(progress * 100).toFixed(0)}%)`;
      }
      return title;
    } else {
      return status;
    }
  });

  // warn the user if they try to leave the page while flashing
  $effect(() => {
    if (Step.DOWNLOADING <= step && step <= Step.ERASING) {
      window.addEventListener("beforeunload", beforeUnloadListener, { capture: true })
    } else {
      window.removeEventListener("beforeunload", beforeUnloadListener, { capture: true })
    }

    return () => {
      window.removeEventListener("beforeunload", beforeUnloadListener, { capture: true })
    }
  })
</script>

<div id="flash">
  <button
    class="p-8 rounded-full {bgColor}"
    style="cursor: pointer"
    onclick={onContinue}
  >
    <img
      src={icon}
      alt="cable"
      width={128}
      height={128}
      class={`${iconStyle} ${!error && step !== Step.DONE ? 'animate-pulse' : ''}`}
    />
  </button>
  <div class="w-full max-w-3xl px-8 transition-opacity duration-300" style="opacity: {progress === -1 ? 0 : 1 }">
    <LinearProgress value={progress * 100} barColor={bgColor} />
  </div>
  <span class={`text-3xl dark:text-white font-mono font-light`}>{title}</span>
  <span class={`text-xl dark:text-white px-8 max-w-xl`}>{description}</span>
  {#if error}
    <button class="retry-button" onclick={handleRetry}>Retry</button>
  {/if}
  {#if connected}
    <DeviceState {serial} />
  {/if}
</div>

<style lang="postcss">
  #flash {
    @apply relative flex flex-col gap-8 justify-center items-center h-full;
  }

  .retry-button {
    @apply px-4 py-2 rounded-md bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 transition-colors;
  }
</style>
