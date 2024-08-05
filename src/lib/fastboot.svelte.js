import { FastbootDevice, setDebugLevel as setFastbootDebugLevel } from 'android-fastboot'

import * as Comlink from 'comlink'

import config from '$lib/config'
import { download } from '$lib/blob'
import { getWorkerInstance } from '$lib/imageWorker.svelte'
import { createManifest } from '$lib/manifest'
import { withProgress } from '$lib/progress'

/**
 * @typedef {import('./manifest.js').Image} Image
 */

setFastbootDebugLevel(2)

export const Step = {
  READY: 0,
  CONNECTING: 1,
  DOWNLOADING: 2,
  UNPACKING: 3,
  FLASHING: 4,
  ERASING: 5,
  DONE: 6,
}

export const Error = {
  UNKNOWN: -1,
  NONE: 0,
  UNRECOGNIZED_DEVICE: 1,
  LOST_CONNECTION: 2,
  DOWNLOAD_FAILED: 3,
  UNPACK_FAILED: 4,
  CHECKSUM_MISMATCH: 5,
  FLASH_FAILED: 6,
  ERASE_FAILED: 7,
  REQUIREMENTS_NOT_MET: 8,
}

function isRecognizedDevice(deviceInfo) {
  // check some variables are as expected for a comma three
  const {
    kernel,
    "max-download-size": maxDownloadSize,
    "slot-count": slotCount,
  } = deviceInfo
  if (kernel !== "uefi" || maxDownloadSize !== "104857600" || slotCount !== "2") {
    console.error('[fastboot] Unrecognised device (kernel, maxDownloadSize or slotCount)', deviceInfo)
    return false
  }

  const partitions = []
  for (const key of Object.keys(deviceInfo)) {
    if (!key.startsWith("partition-type:")) continue
    let partition = key.substring("partition-type:".length)
    if (partition.endsWith("_a") || partition.endsWith("_b")) {
      partition = partition.substring(0, partition.length - 2)
    }
    if (partitions.includes(partition)) continue
    partitions.push(partition)
  }

  // check we have the expected partitions to make sure it's a comma three
  const expectedPartitions = [
    "ALIGN_TO_128K_1", "ALIGN_TO_128K_2", "ImageFv", "abl", "aop", "apdp", "bluetooth", "boot", "cache",
    "cdt", "cmnlib", "cmnlib64", "ddr", "devcfg", "devinfo", "dip", "dsp", "fdemeta", "frp", "fsc", "fsg",
    "hyp", "keymaster", "keystore", "limits", "logdump", "logfs", "mdtp", "mdtpsecapp", "misc", "modem",
    "modemst1", "modemst2", "msadp", "persist", "qupfw", "rawdump", "sec", "splash", "spunvm", "ssd",
    "sti", "storsec", "system", "systemrw", "toolsfv", "tz", "userdata", "vm-linux", "vm-system", "xbl",
    "xbl_config"
  ]
  if (!partitions.every(partition => expectedPartitions.includes(partition))) {
    console.error('[fastboot] Unrecognised device (partitions)', partitions)
    return false
  }

  // sanity check, also useful for logging
  if (!deviceInfo['serialno']) {
    console.error('[fastboot] Unrecognised device (missing serialno)', deviceInfo)
    return false
  }

  return true
}

export function useFastboot() {
  let step = $state(Step.READY)
  let message = $state('')
  let progress = $state(-1)
  let error = $state(Error.NONE)
  let isInitialized = $state(false)

  let connected = $state(false)
  let serial = $state(null)

  let onRetry = $state(null)

  const fastboot = new FastbootDevice()

  let manifest = $state(null)

  let initializePromise = null;

  $inspect(message).with((msg) => console.info('[fastboot]', msg));

  const imageWorker = getWorkerInstance()

  const initialize = async () => {
    if (isInitialized) return true

    if (initializePromise) return initializePromise

    initializePromise = (async () => {
      // Check browser support
      if (typeof navigator.usb === 'undefined') {
        console.error('[fastboot] WebUSB not supported')
        error = Error.REQUIREMENTS_NOT_MET
        return false
      }

      if (typeof Worker === 'undefined') {
        console.error('[fastboot] Web Workers not supported')
        error = Error.REQUIREMENTS_NOT_MET
        return false
      }

      if (typeof Storage === 'undefined') {
        console.error('[fastboot] Storage API not supported')
        error = Error.REQUIREMENTS_NOT_MET
        return false
      }

      if (!imageWorker) {
        console.debug('[fastboot] Waiting for image worker')
        return false
      }

      try {
        await imageWorker?.init()
        const blob = await download(config.manifests['master'])
        const text = await blob.text()
        manifest = createManifest(text)

        if (manifest.length === 0) {
          throw new Error('Manifest is empty')
        }

        console.debug('[fastboot] Loaded manifest', manifest)
        isInitialized = true
        return true
      } catch (err) {
        console.error('[fastboot] Initialization error', err)
        error = Error.UNKNOWN
        return false
      } finally {
        initializePromise = null
      }
    })()

    return initializePromise
  }

  $effect(() => {
    initialize()
  })

  // wait for user interaction (we can't use WebUSB without user event)
  const handleContinue = async () => {
    if (!isInitialized) {
      await initialize();
    }
    if (error !== Error.NONE) return

    step = Step.CONNECTING
  }

  $effect(() => {
    progress = -1
    message = ''

    if (error) return

    switch (step) {
      case Step.CONNECTING: {
        fastboot.waitForConnect()
          .then(() => {
            console.info('[fastboot] Connected', { fastboot })
            return fastboot.getVariable('all')
              .then((all) => {
                const deviceInfo = all.split('\n').reduce((obj, line) => {
                  const parts = line.split(':')
                  const key = parts.slice(0, -1).join(':').trim()
                  obj[key] = parts.slice(-1)[0].trim()
                  return obj
                }, {})

                const recognized = isRecognizedDevice(deviceInfo)
                console.debug('[fastboot] Device info', { recognized, deviceInfo })

                if (!recognized) {
                  error = Error.UNRECOGNIZED_DEVICE
                  return
                }

                serial = deviceInfo['serialno'] || 'unknown'
                connected = true
                step = Step.DOWNLOADING
              })
              .catch((err) => {
                console.error('[fastboot] Error getting device information', err)
                error = Error.UNKNOWN
              })
          })
          .catch((err) => {
            console.error('[fastboot] Connection lost', err)
            error = Error.LOST_CONNECTION
            connected = false
          })

        fastboot.connect()
          .catch((err) => {
            console.error('[fastboot] Connection error', err)
            step = Step.READY
          })
        break
      }

      case Step.DOWNLOADING: {
        progress = 0

        async function downloadImages() {
          for await (const [image, onProgress] of withProgress(manifest, progress)) {
            message = `Downloading ${image.name}`
            await imageWorker.downloadImage(image, Comlink.proxy(onProgress))
          }
        }

        downloadImages()
          .then(() => {
            console.debug('[fastboot] Downloaded all images')
            step = Step.UNPACKING
          })
          .catch((err) => {
            console.error('[fastboot] Download error', err)
            error = Error.DOWNLOAD_FAILED
          })
        break
      }

      case Step.UNPACKING: {
        progress = 0

        async function unpackImages() {
          for await (const [image, onProgress] of withProgress(manifest, progress)) {
            message = `Unpacking ${image.name}`
            await imageWorker.unpackImage(image, Comlink.proxy(onProgress))
          }
        }

        unpackImages()
          .then(() => {
            console.debug('[fastboot] Unpacked all images')
            step = Step.FLASHING
          })
          .catch((err) => {
            console.error('[fastboot] Unpack error', err)
            if (err.startsWith('Checksum mismatch')) {
              error = Error.CHECKSUM_MISMATCH
            } else {
              error = Error.UNPACK_FAILED
            }
          })
        break
      }

      case Step.FLASHING: {
        progress = 0

        async function flashDevice() {
          const currentSlot = await fastboot.getVariable('current-slot')
          if (!['a', 'b'].includes(currentSlot)) {
            throw `Unknown current slot ${currentSlot}`
          }

          for await (const [image, onProgress] of withProgress(manifest, progress)) {
            const fileHandle = await imageWorker.getImage(image)
            const blob = await fileHandle.getFile()

            if (image.sparse) {
              message = `Erasing ${image.name}`
              await fastboot.runCommand(`erase:${image.name}`)
            }
            message = `Flashing ${image.name}`
            await fastboot.flashBlob(image.name, blob, onProgress, 'other')
          }
          console.debug('[fastboot] Flashed all partitions')

          const otherSlot = currentSlot === 'a' ? 'b' : 'a'
          message = `Changing slot to ${otherSlot}`
          await fastboot.runCommand(`set_active:${otherSlot}`)
        }

        flashDevice()
          .then(() => {
            console.debug('[fastboot] Flash complete')
            step = Step.ERASING
          })
          .catch((err) => {
            console.error('[fastboot] Flashing error', err)
            error = Error.FLASH_FAILED
          })
        break
      }

      case Step.ERASING: {
        progress = 0

        async function eraseDevice() {
          message = 'Erasing userdata'
          await fastboot.runCommand('erase:userdata')
          progress = 0.9

          message = 'Rebooting'
          await fastboot.runCommand('continue')
          progress = 1
          connected = false
        }

        eraseDevice()
          .then(() => {
            console.debug('[fastboot] Erase complete')
            step = Step.DONE
          })
          .catch((err) => {
            console.error('[fastboot] Erase error', err)
            error = Error.ERASE_FAILED
          })
        break
      }
    }
  })

  $effect(() => {
    if (error !== Error.NONE) {
      console.debug('[fastboot] error', error)
      progress = -1

      onRetry = () => {
        console.debug('[fastboot] on retry')
        window.location.reload()
      }
    }
  })

  return {
    step,
    message,
    progress,
    error,
    connected,
    serial,
    onContinue: handleContinue,
    onRetry,
  }
}
