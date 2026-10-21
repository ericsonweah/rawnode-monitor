
'use strict';
import colorsFunction from "./functions/colorsFunction.js";
import os from "os";
import readline from "readline";
import https from "https";
import process from "process";


// src/submodules/color/core.js

// Core functionality of colors// moved import for os// moved import for readline// moved import for https// moved import for processconst colorsFunction = tmp_colorsFunction();

// Check if colors should be used based on environment variable.
let useColors = process.env.USE_COLORS !== "false";
let currentTheme = null; // Placeholder for theme configuration if set

const defaultRGBConfig = {
    R: 30,
    G: 2,
    B: 208,
};

export const applyColor = (colorFunction) => (string) => (useColors ? colorFunction(string) : string);

const wrappedColors = {};
for (const [key, func] of Object.entries(colorsFunction)) {
    wrappedColors[key] = applyColor(func);

wrappedColors[key] = wrappedColors[key];

    
}

// Add predefined themes
const neonTheme = {
    pink: { R: 255, G: 20, B: 147 },
    green: { R: 57, G: 255, B: 20 },
    blue: { R: 0, G: 191, B: 255 },
    yellow: { R: 255, G: 255, B: 0 },
    purple: { R: 138, G: 43, B: 226 },
};

const earthTheme = {
    brown: { R: 139, G: 69, B: 19 },
    forestGreen: { R: 34, G: 139, B: 34 },
    beige: { R: 245, G: 245, B: 220 },
    skyBlue: { R: 135, G: 206, B: 235 },
    clay: { R: 210, G: 105, B: 30 },
};

const galacticTheme = {
    starBlue: { R: 100, G: 149, B: 237 },
    cosmicPink: { R: 255, G: 20, B: 147 },
    nebulaPurple: { R: 72, G: 61, B: 139 },
    asteroidGray: { R: 112, G: 128, B: 144 },
    moonWhite: { R: 240, G: 240, B: 255 },
};

const themes = {
    dark: {
        error: wrappedColors.red,
        warn: wrappedColors.yellow,
        info: wrappedColors.green,
    },
    light: {
        error: wrappedColors.red,
        warn: wrappedColors.yellow,
        info: wrappedColors.blue,
    },
    neon: neonTheme,
    earth: earthTheme,
    galactic: galacticTheme,
};


export const trendWave = (interval = 10000, amplitude = 2, frequency = 0.2) => {
  let step = 0;

  const getTrends = async () => {
    return new Promise((resolve, reject) => {
      https.get(
        'https://api.twitter.com/1.1/trends/place.json?id=1', // Use your Twitter API endpoint
        {
          headers: {
            Authorization: `Bearer YOUR_TWITTER_API_BEARER_TOKEN`,
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              const trendsData = JSON.parse(data);
              const trends = trendsData[0].trends.map((t) => t.name);
              resolve(trends.slice(0, 5)); // Return the top 5 trends
            } catch (error) {
              reject(error);
            }
          });
        }
      ).on('error', (err) => reject(err));
    });
  };

  const intervalId = setInterval(async () => {
    try {
      const trends = await getTrends();
      const waveText = trends
        .join(' | ')
        .split('')
        .map((char, i) => {
          const offset = Math.round(amplitude * Math.sin(frequency * (i + step)));
          return `\x1b[${offset > 0 ? `${offset}A` : `${-offset}B`}${char}\x1b[0m`;
        })
        .join('');

      console.clear();
      process.stdout.write(`\r${waveText}\x1b[0m`);
      step++;
    } catch (error) {
      console.error('Error fetching social media trends:', error.message);
      clearInterval(intervalId);
    }
  }, interval);

  return () => clearInterval(intervalId); // Stop the animation
};

export const cryptoWave = (crypto = 'bitcoin', currency = 'usd', interval = 5000, amplitude = 2, frequency = 0.2) => {
  let step = 0;

  const getCryptoPrice = async () => {
    return new Promise((resolve, reject) => {
      https.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${crypto}&vs_currencies=${currency}`,
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              const priceData = JSON.parse(data);
              const price = priceData[crypto][currency];
              resolve(price);
            } catch (error) {
              reject(error);
            }
          });
        }
      ).on('error', (err) => reject(err));
    });
  };

  const intervalId = setInterval(async () => {
    try {
      const price = await getCryptoPrice();
      const waveText = `Crypto: ${crypto.toUpperCase()} - $${price}`
        .split('')
        .map((char, i) => {
          const offset = Math.round(amplitude * Math.sin(frequency * (i + step)));
          return `\x1b[${offset > 0 ? `${offset}A` : `${-offset}B`}${char}\x1b[0m`;
        })
        .join('');

      console.clear();
      process.stdout.write(`\r${waveText}\x1b[0m`);
      step++;
    } catch (error) {
      console.error('Error fetching cryptocurrency price:', error.message);
      clearInterval(intervalId);
    }
  }, interval);

  return () => clearInterval(intervalId); // Stop the animation
};




export const weatherWave = (city = 'New York', apiKey = 'YOUR_API_KEY', interval = 2000, amplitude = 2, frequency = 0.2) => {
  let step = 0;

  const getWeatherData = async () => {
    return new Promise((resolve, reject) => {
      https.get(
        `https://api.openweathermap.org/data/2.5/weather?q=${city}&units=metric&appid=${apiKey}`,
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              const weatherData = JSON.parse(data);
              const temp = weatherData.main.temp;
              const condition = weatherData.weather[0].description;
              resolve({ temp, condition });
            } catch (error) {
              reject(error);
            }
          });
        }
      ).on('error', (err) => reject(err));
    });
  };

  const intervalId = setInterval(async () => {
    try {
      const { temp, condition } = await getWeatherData();
      const waveText = `Weather in ${city}: ${temp}°C, ${condition}`
        .split('')
        .map((char, i) => {
          const offset = Math.round(amplitude * Math.sin(frequency * (i + step)));
          return `\x1b[${offset > 0 ? `${offset}A` : `${-offset}B`}${char}\x1b[0m`;
        })
        .join('');

      console.clear();
      process.stdout.write(`\r${waveText}\x1b[0m`);
      step++;
    } catch (error) {
      console.error('Error fetching weather data:', error.message);
      clearInterval(intervalId);
    }
  }, interval);

  return () => clearInterval(intervalId); // Stop the animation
};

export const stockWave = (symbol = 'AAPL', interval = 2000, amplitude = 2, frequency = 0.2) => {
  let step = 0;

  const getStockPrice = async () => {
    return new Promise((resolve, reject) => {
      https.get(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=cu8d491r01qhqu5cnrm0cu8d491r01qhqu5cnrmg`, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const stockData = JSON.parse(data);
            resolve(stockData.c); // Current price
          } catch (error) {
            reject(error);
          }
        });
      }).on('error', (err) => reject(err));
    });
  };

  const intervalId = setInterval(async () => {
    try {
      const price = await getStockPrice();
      const waveText = `${symbol}: $${price.toFixed(2)}`
        .split('')
        .map((char, i) => {
          const offset = Math.round(amplitude * Math.sin(frequency * (i + step)));
          return `\x1b[${offset > 0 ? `${offset}A` : `${-offset}B`}${char}\x1b[0m`;
        })
        .join('');

      console.clear();
      process.stdout.write(`\r${waveText}\x1b[0m`);
      step++;
    } catch (error) {
      console.error('Error fetching stock price:', error.message);
      clearInterval(intervalId);
    }
  }, interval);

  return () => clearInterval(intervalId); // Return a function to stop the wave
};


export const cpuWave = (interval = 500, amplitude = 2, frequency = 0.2) => {
  let step = 0;

  const getCpuUsage = () => {
    const cpus = os.cpus();
    let idleTime = 0;
    let totalTime = 0;

    cpus.forEach((cpu) => {
      for (const type in cpu.times) {
        totalTime += cpu.times[type];
      }
      idleTime += cpu.times.idle;
    });

    const usage = 1 - idleTime / totalTime; // CPU usage as a percentage
    return Math.round(usage * 100); // Return percentage (0-100)
  };

  const intervalId = setInterval(() => {
    const usage = getCpuUsage();
    const waveText = `CPU Usage: ${usage}%`
      .split('')
      .map((char, i) => {
        const offset = Math.round(amplitude * Math.sin(frequency * (i + step)));
        return `\x1b[${offset > 0 ? `${offset}A` : `${-offset}B`}${char}\x1b[0m`;
      })
      .join('');

    console.clear();
    process.stdout.write(`\r${waveText}\x1b[0m`);
    step++;
  }, interval);

  return () => clearInterval(intervalId); // Return a function to stop the wave
};


export const gridWave = (grid = [['Wave 1', 'Wave 2'], ['Wave 3', 'Wave 4']], interval = 100) => {
    let step = 0;
  
    const intervalId = setInterval(() => {
      console.clear();
      grid.forEach((row, rowIndex) => {
        row.forEach((string, colIndex) => {
          const amplitude = 2 + rowIndex;
          const frequency = 0.2 + colIndex * 0.1;
          const waveText = string
            .split('')
            .map((char, i) => {
              const offset = Math.round(amplitude * Math.sin(frequency * (i + step)));
              return `\x1b[${offset > 0 ? `${offset}A` : `${-offset}B`}${char}\x1b[0m`;
            })
            .join('');
          process.stdout.write(waveText + '  ');
        });
        console.log('\n');
      });
      step++;
    }, interval);
  
    return () => clearInterval(intervalId); // Stop the animation
  };
  
export const interactiveWaveArt = (amplitude = 2, frequency = 0.2, interval = 100) => {
    const inputArt = [];
    console.log('Enter your ASCII art (press Enter twice to start):');
  
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
  
    process.stdin.on('data', (line) => {
      if (line.trim() === '') {
        process.stdin.pause();
        startWaveAnimation(inputArt, amplitude, frequency, interval);
      } else {
        inputArt.push(line.trim());
      }
    });
  
    const startWaveAnimation = (asciiArt, amplitude, frequency, interval) => {
      let step = 0;
  
      const intervalId = setInterval(() => {
        console.clear();
        asciiArt.forEach((line, i) => {
          const offset = Math.round(amplitude * Math.sin(frequency * (i + step)));
          const verticalOffset = offset > 0 ? `${offset}A` : `${-offset}B`;
          process.stdout.write(`\x1b[${verticalOffset}${line}\x1b[0m\n`);
        });
        step++;
      }, interval);
  
      process.stdin.on('data', () => {
        clearInterval(intervalId);
        console.log('\nWave stopped.');
      });
    };
  };
  

export const circularWave = (string = 'Circular Wave!', radius = 10, interval = 100) => {
    let angle = 0;
  
    const intervalId = setInterval(() => {
      console.clear();
      string.split('').forEach((char, i) => {
        const x = Math.round(radius * Math.cos(angle + (i * Math.PI) / 6));
        const y = Math.round(radius * Math.sin(angle + (i * Math.PI) / 6));
        process.stdout.write(`\x1b[${y > 0 ? `${y}B` : `${-y}A`}${x > 0 ? `${x}C` : `${-x}D`}${char}\x1b[0m\n`);
      });
      angle += 0.1;
    }, interval);
  
    return () => clearInterval(intervalId); // Stop the animation
  };
  

export const fadingWave = (string = 'Fading Wave!', amplitude = 2, frequency = 0.2, interval = 100) => {
    let step = 0;
  
    const intervalId = setInterval(() => {
      const waveText = string
        .split('')
        .map((char, i) => {
          const offset = Math.round(amplitude * Math.sin(frequency * (i + step)));
          const opacity = Math.round(255 * Math.abs(Math.sin(frequency * (i + step))));
          const color = `\x1b[38;2;${opacity};${opacity};${opacity}m`;
          return `${color}\x1b[${offset > 0 ? `${offset}A` : `${-offset}B`}${char}\x1b[0m`;
        })
        .join('');
  
      process.stdout.write(`\r${waveText}\x1b[0m`);
      step++;
    }, interval);
  
    return () => clearInterval(intervalId); // Stop the animation
  };
  

export const asciiArtWave = (
    asciiArt = [
      '  ____',
      ' / __ \\',
      '| |  | |_   _ _ __   __ _',
      '| |  | | | | | \'_ \\ / _` |',
      '| |__| | |_| | | | | (_| |',
      ' \\____/ \\__,_|_| |_|\\__,_|'
    ],
    amplitude = 2,
    frequency = 0.2,
    interval = 100
  ) => {
    let step = 0;
  
    const intervalId = setInterval(() => {
      console.clear();
      asciiArt.forEach((line, i) => {
        const offset = Math.round(amplitude * Math.sin(frequency * (i + step)));
        const verticalOffset = offset > 0 ? `${offset}A` : `${-offset}B`;
        process.stdout.write(`\x1b[${verticalOffset}${line}\x1b[0m\n`);
      });
      step++;
    }, interval);
  
    return () => clearInterval(intervalId); // Stop the animation
  };
  
export const waveMatrix = (strings = ['Wave 1', 'Wave 2', 'Wave 3'], interval = 100) => {
    let step = 0;
  
    const intervalId = setInterval(() => {
      console.clear();
      strings.forEach((string, index) => {
        const amplitude = 2 + index; // Each wave has a different amplitude
        const frequency = 0.2 + index * 0.1; // Each wave has a different frequency
        const waveText = string
          .split('')
          .map((char, i) => {
            const offset = Math.round(amplitude * Math.sin(frequency * (i + step)));
            return `\x1b[${offset > 0 ? `${offset}A` : `${-offset}B`}${char}\x1b[0m`;
          })
          .join('');
        console.log(waveText);
      });
      step++;
    }, interval);
  
    return () => clearInterval(intervalId); // Return a function to stop the matrix
  };
  
export const combinedWave = (
    string = 'Combined Wave!',
    amplitude = 2,
    frequency = 0.2,
    interval = 100
  ) => {
    let step = 0;
  
    const intervalId = setInterval(() => {
      const waveText = string
        .split('')
        .map((char, i) => {
          const offset = Math.round(amplitude * Math.sin(frequency * (i + step)));
          const color = `\x1b[38;2;${(i * 20) % 255};${(i * 40) % 255};${(i * 60) % 255}m`;
          const bgColor = `\x1b[48;2;${(i * 50) % 255};${(i * 80) % 255};${(i * 30) % 255}m`;
          return `${color}${bgColor}\x1b[${offset > 0 ? `${offset}A` : `${-offset}B`}${char}\x1b[0m`;
        })
        .join('');
  
      process.stdout.write(`\r${waveText}\x1b[0m`);
      step++;
    }, interval);
  
    return () => clearInterval(intervalId); // Return a function to stop the wave
  };
  

export const smoothWave = (string = 'Smooth Wave!', amplitude = 2, frequency = 0.2, interval = 100) => {
    let step = 0;
  
    const intervalId = setInterval(() => {
      const waveText = string
        .split('')
        .map((char, i) => {
          const offset = amplitude * Math.sin(frequency * (i + step));
          return `\x1b[${Math.abs(offset)}C${char}\x1b[0m`;
        })
        .join('');
  
      process.stdout.write(`\r${waveText}\x1b[0m`);
      step += 0.1;
    }, interval);
  
    return () => clearInterval(intervalId); // Return a function to stop the wave
  };
  

export const bgWave = (string = 'Background Wave!', amplitude = 2, frequency = 0.2, interval = 100) => {
    let step = 0;
  
    const intervalId = setInterval(() => {
      const waveText = string
        .split('')
        .map((char, i) => {
          const offset = Math.round(amplitude * Math.sin(frequency * (i + step)));
          const bgColor = `\x1b[48;2;${(i * 50) % 255};${(i * 80) % 255};${(i * 30) % 255}m`;
          return `${bgColor}\x1b[${offset > 0 ? `${offset}A` : `${-offset}B`}${char}\x1b[0m`;
        })
        .join('');
  
      process.stdout.write(`\r${waveText}\x1b[0m`);
      step++;
    }, interval);
  
    return () => clearInterval(intervalId); // Return a function to stop the wave
  };
  

export const colorWave = (string = 'Colorful Wave!', amplitude = 2, frequency = 0.2, interval = 100) => {
    let step = 0;
  
    const intervalId = setInterval(() => {
      const waveText = string
        .split('')
        .map((char, i) => {
          const offset = Math.round(amplitude * Math.sin(frequency * (i + step)));
          const color = `\x1b[38;2;${(i * 20) % 255};${(i * 40) % 255};${(i * 60) % 255}m`;
          return `${color}\x1b[${offset > 0 ? `${offset}A` : `${-offset}B`}${char}\x1b[0m`;
        })
        .join('');
  
      process.stdout.write(`\r${waveText}\x1b[0m`);
      step++;
    }, interval);
  
    return () => clearInterval(intervalId); // Return a function to stop the wave
  };
  


export const dynamicWave = (string = 'Wave Text!', amplitude = 2, frequency = 0.2, interval = 100) => {
    let step = 0;
    let dynamicAmplitude = amplitude;
    let dynamicFrequency = frequency;
  
    const intervalId = setInterval(() => {
      const waveText = string
        .split('')
        .map((char, i) => {
          const offset = Math.round(dynamicAmplitude * Math.sin(dynamicFrequency * (i + step)));
          return `\x1b[${offset > 0 ? `${offset}A` : `${-offset}B`}${char}\x1b[0m`;
        })
        .join('');
  
      process.stdout.write(`\r${waveText}\x1b[0m`);
  
      // Dynamically adjust wave parameters
      dynamicAmplitude = amplitude + Math.sin(step * 0.05); // Oscillating amplitude
      dynamicFrequency = frequency + Math.cos(step * 0.03) * 0.05; // Oscillating frequency
      step++;
    }, interval);
  
    return () => clearInterval(intervalId); // Return a function to stop the wave
  };
  


export const dashboard = () => {
    // Menu items for navigation
const menuItems = [
    'Progress Bar',
    'Spinner',
    'Static Line Chart',
    'Real-Time Line Chart',
    'Bar Chart',
    'Exit',
  ];
  
  let selectedIndex = 0; // Track the currently selected menu index
  
  // Render the menu with the currently selected item highlighted
  const renderMenu = () => {
    console.clear();
    console.log('=== Interactive Dashboard ===\n');
    menuItems.forEach((item, index) => {
      if (index === selectedIndex) {
        console.log(`\x1b[7m${item}\x1b[0m`); // Highlight selected
      } else {
        console.log(item);
      }
    });
  };
  
  // Handle each menu item action
  const handleMenuSelection = () => {
    switch (menuItems[selectedIndex]) {
      case 'Progress Bar':
        showProgressBar();
        break;
      case 'Spinner':
        showSpinner();
        break;
      case 'Static Line Chart':
        showStaticLineChart();
        break;
      case 'Real-Time Line Chart':
        showRealTimeLineChart();
        break;
      case 'Bar Chart':
        showBarChart();
        break;
      case 'Exit':
        process.exit(0);
    }
  };
  
  // Show progress bar
  const showProgressBar = () => {
    console.clear();
    console.log('=== Progress Bar ===\n');
    const bar = progressBar(100, { prefix: 'Loading: ' });
    let progress = 0;
    const interval = setInterval(() => {
      bar.increment(5);
      progress += 5;
      if (progress >= 100) {
        clearInterval(interval);
        bar.complete();
        setTimeout(renderMenu, 2000);
      }
    }, 100);
  };
  
  // Show spinner
  const showSpinner = () => {
    console.clear();
    console.log('=== Spinner ===\n');
    const stopSpinner = spinner(['|', '/', '-', '\\'], 100);
    setTimeout(() => {
      stopSpinner();
      setTimeout(renderMenu, 2000);
    }, 5000);
  };
  
  // Show static line chart
  const showStaticLineChart = () => {
    console.clear();
    console.log('=== Static Line Chart ===\n');
    lineChart([3, 5, 2, 8, 6, 7, 4, 5, 9, 6], 50, 10);
    setTimeout(renderMenu, 5000);
  };
  
  // Show real-time line chart
  const showRealTimeLineChart = () => {
    console.clear();
    console.log('=== Real-Time Line Chart ===\n');
    realTimeChart([3, 5, 2, 8, 6, 7, 4, 5, 9, 6], 500);
    setTimeout(renderMenu, 6000);
  };
  
  // Show bar chart
  const showBarChart = () => {
    console.clear();
    console.log('=== Bar Chart ===\n');
    barChart([10, 15, 20, 5, 25], { labels: ['A', 'B', 'C', 'D', 'E'], height: 10 });
    setTimeout(renderMenu, 5000);
  };
  
  // Listen for keypress events
  const listenForKeypress = () => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
  
    process.stdin.on('data', (key) => {
      if (key === '\u0003') { // Ctrl+C to exit
        process.exit();
      }
      if (key === '\x1b[A') { // Up arrow
        selectedIndex = (selectedIndex - 1 + menuItems.length) % menuItems.length;
        renderMenu();
      }
      if (key === '\x1b[B') { // Down arrow
        selectedIndex = (selectedIndex + 1) % menuItems.length;
        renderMenu();
      }
      if (key === '\r') { // Enter key
        handleMenuSelection();
      }
    });
  };
  
  // Initialize the dashboard
  const startDashboard = () => {
    renderMenu();
    listenForKeypress();
  };
  startDashboard();
}


export const range = (start = 0, end = 5, step = 1)  => {
    if (step === 0) throw new Error("Step cannot be zero.");
    const range = [];
    if (step > 0) {
        for (let i = start; i <= end; i += step) {
            range.push(i);
        }
    } else {
        for (let i = start; i >= end; i += step) {
            range.push(i);
        }
    }
    return range;
}




export const realTimeChart = (data = [3, 5, 2, 8, 6, 7, 4, 5, 9, 6], interval = 500) => {
    let currentIndex = 0;
  
    const updateChart = () => {
      const subset = data.slice(0, currentIndex + 1);
      console.clear();

      // UPDATED
lineChart(subset, 50, 10);

      currentIndex++;
      if (currentIndex >= data.length) {
        clearInterval(chartInterval);
      }
    };
  
    const chartInterval = setInterval(updateChart, interval);
  };
  


export const barChart = (data = [10, 15, 20, 5, 25], options = { labels: ['A', 'B', 'C', 'D', 'E'], height: 20 }) => {
    const { width = 50, height = 10, labels = [] } = options;
    const max = Math.max(...data);
  
    data.forEach((value, index) => {
      const barHeight = Math.round((value / max) * height);
      console.log(
        `${labels[index] || index.toString().padEnd(4)}| ${'#'.repeat(barHeight)}`
      );
    });
    console.log('-'.repeat(width)); // X-axis
  };
  

export const lineChart = (data = [3, 5, 2, 8, 6, 7, 4, 5, 9, 6], width = 5, height = 10) => {
    const max = Math.max(...data);
    const min = Math.min(...data);
  
    const scale = (value) => Math.round(((value - min) / (max - min)) * height);
  
    const chart = data.map((value) => scale(value));
    for (let i = height; i >= 0; i--) {
      let line = '';
      chart.forEach((point) => {
        line += point === i ? '*' : ' ';
      });
      console.log(line);
    }
    console.log('-'.repeat(width)); // X-axis
  };
  

export const progressBar = (total = 100, options = { prefix: 'Loading: ' }) => {
    const { width = 30, char = '=', emptyChar = ' ', prefix = '' } = options;
  
    let current = 0;
    const render = () => {
      const progress = Math.min(current / total, 1);
      const filled = Math.round(progress * width);
      const bar = `${char.repeat(filled)}${emptyChar.repeat(width - filled)}`;
      process.stdout.write(`\r${prefix}[${bar}] ${Math.round(progress * 100)}%`);
    };
  
    return {
      increment: (amount = 1) => {
        current += amount;
        render();
      },
      complete: () => {
        current = total;
        render();
        process.stdout.write('\n');
      },
    };
  };
  

  export const interactiveMenu = (menuItems = ['Option 1', 'Option 2', 'Option 3', 'Exit']) => {
    let selectedIndex = 0;
  
    const renderMenu = () => {
      console.clear();
      menuItems.forEach((item, index) => {
        if (index === selectedIndex) {
          console.log(`\x1b[7m${item}\x1b[0m`); // Highlight selected item
        } else {
          console.log(item);
        }
      });
    };
  
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
  
    const onKeyPress = (key) => {
      if (key === '\u0003') { // Exit on Ctrl+C
        process.stdin.setRawMode(false);
        process.stdin.pause();
        return;
      }
      if (key === '\x1b[A') { // Up arrow
        selectedIndex = (selectedIndex - 1 + menuItems.length) % menuItems.length;
        renderMenu();
      }
      if (key === '\x1b[B') { // Down arrow
        selectedIndex = (selectedIndex + 1) % menuItems.length;
        renderMenu();
      }
      if (key === '\r') { // Enter key
        process.stdin.removeListener('data', onKeyPress); // Remove listener to prevent further input
        process.stdin.setRawMode(false);
        process.stdin.pause();
        console.clear(); // Clear the screen before showing the selected item
        console.log(`You selected: \x1b[1m${menuItems[selectedIndex]}\x1b[0m\n`);
      }
    };
  
    process.stdin.on('data', onKeyPress);
    renderMenu();
  };
  

export const multiLineGradient = (startColor = [255, 0, 0], endColor = [0, 0, 255], textLines = ['First Line', 'Second Line', 'Third Line', 'Fourth Line']) => {
    const [r1, g1, b1] = startColor;
    const [r2, g2, b2] = endColor;
  
    const lineCount = textLines.length;
    return textLines
      .map((line, i) => {
        const r = Math.round(r1 + ((r2 - r1) * i) / (lineCount - 1));
        const g = Math.round(g1 + ((g2 - g1) * i) / (lineCount - 1));
        const b = Math.round(b1 + ((b2 - b1) * i) / (lineCount - 1));
        return `\x1b[38;2;${r};${g};${b}m${line}\x1b[0m`;
      })
      .join('\n');
  };
  

export const spinner = (frames = ['|', '/', '-', '\\'], interval = 100) => {
    let frameIndex = 0;
  
    const intervalId = setInterval(() => {
      process.stdout.write(`\r${frames[frameIndex]} `);
      frameIndex = (frameIndex + 1) % frames.length;
    }, interval);
  
    return () => {
      clearInterval(intervalId);
      process.stdout.write('\rDone!        \n'); // Clear spinner after stopping
    };
  };
  
export const gradientBox = (startColor = [255, 0, 0], endColor = [0, 0, 255], width = 40, height = 10, text = 'Gradient Box') => {
    const [r1, g1, b1] = startColor;
    const [r2, g2, b2] = endColor;
  
    const gradientRow = (rowIndex) => {
      const r = Math.round(r1 + ((r2 - r1) * rowIndex) / (height - 1));
      const g = Math.round(g1 + ((g2 - g1) * rowIndex) / (height - 1));
      const b = Math.round(b1 + ((b2 - b1) * rowIndex) / (height - 1));
      return `\x1b[48;2;${r};${g};${b}m${' '.repeat(width)}\x1b[0m`;
    };
  
    const lines = Array.from({ length: height }, (_, i) => gradientRow(i));
    lines[Math.floor(height / 2)] = lines[Math.floor(height / 2)]
      .split('')
      .map((char, i) => (i < text.length ? text[i] : char))
      .join('');
  
    return lines.join('\n');
  };

  export const interactiveTyping = (promptText = 'Type something: ', style = (text) => text) => {
    let typedInput = ''; // Store the typed input
    process.stdout.write(`${promptText}`);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
  
    process.stdin.on('data', (key) => {
      if (key === '\u0003') { // Exit on Ctrl+C
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write('\n');
        return;
      }
  
      if (key === '\r') { // Enter key
        process.stdout.write('\n'); // Move to the next line
        console.log(`You typed: ${style(typedInput)}`); // Output the final input
        process.stdin.setRawMode(false);
        process.stdin.pause(); // Stop listening for input
        return;
      }
  
      if (key === '\u007F') { // Backspace key
        if (typedInput.length > 0) {
          typedInput = typedInput.slice(0, -1); // Remove the last character
          process.stdout.write('\b \b'); // Erase the character from the terminal
        }
        return;
      }
  
      typedInput += key; // Add the key to the typed input
      process.stdout.write(style(key)); // Display the key with styling
    });
  };
  
export const sparkle = (string  = 'Sparkling Text!', colors = [
    [255, 255, 0],  // Yellow
    [255, 0, 255],  // Magenta
    [0, 255, 255],  // Cyan
    [255, 165, 0],  // Orange
    [255, 0, 0],    // Red
  ], interval = 100) => {
    const colorCount = colors.length;
  
    const intervalId = setInterval(() => {
      const sparklingText = string
        .split('')
        .map((char) => {
          const [r, g, b] = colors[Math.floor(Math.random() * colorCount)];
          return `\x1b[38;2;${r};${g};${b}m${char}\x1b[0m`;
        })
        .join('');
      process.stdout.write(`\r${sparklingText}`);
    }, interval);
  
    return () => clearInterval(intervalId); // Return a function to stop the sparkle
  };
export const wavy = (string = 'Wave Text!', amplitude = 2, frequency = 0.2, interval = 100) => {
    let step = 0;
  
    const intervalId = setInterval(() => {
      const waveText = string
        .split('')
        .map((char, i) => {
          const offset = Math.round(amplitude * Math.sin(frequency * (i + step)));
          return `\x1b[${offset > 0 ? `${offset}A` : `${-offset}B`}${char}\x1b[0m`;
        })
        .join('');
      process.stdout.write(`\r${waveText}\x1b[0m`);
      step++;
    }, interval);
  
    return () => clearInterval(intervalId); // Return a function to stop the wave
  };
export const animatedRainbow = (string = 'Animated Rainbow Text!', interval = 100) => {
    const colors = [
      [255, 0, 0],   // Red
      [255, 165, 0], // Orange
      [255, 255, 0], // Yellow
      [0, 255, 0],   // Green
      [0, 127, 255], // Blue
      [139, 0, 255], // Indigo
      [75, 0, 130],  // Violet
    ];
    let offset = 0;
  
    const intervalId = setInterval(() => {
      const rainbowText = string
        .split('')
        .map((char, i) => {
          const [r, g, b] = colors[(i + offset) % colors.length];
          return `\x1b[38;2;${r};${g};${b}m${char}\x1b[0m`;
        })
        .join('');
      process.stdout.write(`\r${rainbowText}`);
      offset++;
    }, interval);
  
    return () => clearInterval(intervalId); // Return a function to stop animation
  };
  

export const pulsate = (string = 'Pulsating Gradient!', color1 = [255, 0, 0], color2 = [0, 0, 255], interval = 100) => {
    let toggle = true;
    const intervalId = setInterval(() => {
      const color = toggle ? color1 : color2;

      // UPDATED
const gradientText = gradient(color, color1)(string);

      process.stdout.write(`\r${gradientText}`);
      toggle = !toggle;
    }, interval);
  
    return () => clearInterval(intervalId); // Return a function to stop pulsating
  };
  

export const bgGradient = (startColor = [255, 0, 0], endColor = [0, 0, 255]) => (string = 'This has a background gradient!') => {
    const [r1, g1, b1] = startColor;
    const [r2, g2, b2] = endColor;
    const length = string.length;
  
    return string
      .split('')
      .map((char, i) => {
        const r = Math.round(r1 + ((r2 - r1) * i) / (length - 1));
        const g = Math.round(g1 + ((g2 - g1) * i) / (length - 1));
        const b = Math.round(b1 + ((b2 - b1) * i) / (length - 1));
        return `\x1b[48;2;${r};${g};${b}m${char}\x1b[0m`;
      })
      .join('');
  };
  
export const scroll = (string = 'Scrolling Text!', width = 20, interval = 100) => {
    let offset = 0;
    const paddedString = `${' '.repeat(width)}${string}${' '.repeat(width)}`;
    const intervalId = setInterval(() => {
      const display = paddedString.substring(offset, offset + width);
      process.stdout.write(`\r${display}`);
      offset = (offset + 1) % paddedString.length;
    }, interval);
  
    return () => clearInterval(intervalId); // Return a function to stop scrolling
  };
  

export const type = (string = 'This text appears like typing!', delay = 100) => {
    let index = 0;
    const intervalId = setInterval(() => {
      if (index < string.length) {
        process.stdout.write(string[index]);
        index++;
      } else {
        clearInterval(intervalId);
        process.stdout.write('\n'); // Add a newline after typing completes
      }
    }, delay);
  };

export const blink = (string = 'Blinking Text!', interval = 500) => {
    let visible = true;
    const intervalId = setInterval(() => {
      process.stdout.write(`\r${visible ? string : ' '.repeat(string.length)}`);
      visible = !visible;
    }, interval);
  
    return () => clearInterval(intervalId); // Return a function to stop the blinking
  };

// Function to apply default RGB values
export const applyDefaults = (R, G, B) => ({
    R: R !== undefined ? R : defaultRGBConfig.R,
    G: G !== undefined ? G : defaultRGBConfig.G,
    B: B !== undefined ? B : defaultRGBConfig.B,
});

// Function to generate RGB-styled string
export const rgb = (R, G, B) => (string) => {
    try {
        // Apply default RGB values

        // UPDATED: use ESM identifier
const { R: r, G: g, B: b } = applyDefaults(R, G, B);


        // Validate RGB values
        if ([r, g, b].some((value) => value < 0 || value > 255)) {
            throw new Error("RGB values must be in the range 0-255.");
        }

        // Return the styled string or plain string if colors are disabled
        return useColors
            ? `\x1b[38;2;${r};${g};${b}m${string}\x1b[0m`
            : string;
    } catch (e) {
        return `Error generating colored text: ${e.message}`;
    }
};



export const bgRgb = (R, G, B) => (string) => {
    try {
        const { R: r, G: g, B: b } = applyDefaults(R, G, B);
        return useColors ? `\x1b[48;2;${r};${g};${b}m${string}\x1b[0m` : string;
    } catch (e) {
        const error = new Error("Invalid RGB values. Must R, G, and B values be specified");
        return "Error generating ASCII art: " + error.message;
    }
};

export const hsvToRgb = (H, S, V) => {
    const C = V * S; // Chroma
    const X = C * (1 - Math.abs(((H / 60) % 2) - 1));
    const m = V - C;

    let r = 0,
        g = 0,
        b = 0;

    if (H >= 0 && H < 60) [r, g, b] = [C, X, 0];
    else if (H >= 60 && H < 120) [r, g, b] = [X, C, 0];
    else if (H >= 120 && H < 180) [r, g, b] = [0, C, X];
    else if (H >= 180 && H < 240) [r, g, b] = [0, X, C];
    else if (H >= 240 && H < 300) [r, g, b] = [X, 0, C];
    else if (H >= 300 && H < 360) [r, g, b] = [C, 0, X];

    // Convert to 0–255 range
    r = Math.round((r + m) * 255);
    g = Math.round((g + m) * 255);
    b = Math.round((b + m) * 255);

    return { r, g, b };
};

export const hslToRgb = (H, S, L) => {
    S /= 100; // Convert saturation to a fraction
    L /= 100; // Convert lightness to a fraction

    const C = (1 - Math.abs(2 * L - 1)) * S; // Chroma
    const X = C * (1 - Math.abs(((H / 60) % 2) - 1));
    const m = L - C / 2;

    let r = 0,
        g = 0,
        b = 0;

    if (H >= 0 && H < 60) [r, g, b] = [C, X, 0];
    else if (H >= 60 && H < 120) [r, g, b] = [X, C, 0];
    else if (H >= 120 && H < 180) [r, g, b] = [0, C, X];
    else if (H >= 180 && H < 240) [r, g, b] = [0, X, C];
    else if (H >= 240 && H < 300) [r, g, b] = [X, 0, C];
    else if (H >= 300 && H < 360) [r, g, b] = [C, 0, X];

    // Convert to 0–255 range
    r = Math.round((r + m) * 255);
    g = Math.round((g + m) * 255);
    b = Math.round((b + m) * 255);

    return { r, g, b };
};

export const hsv = (H, S, V) => (string) => {
    // Convert S and V from percentage (0-100) to fraction (0-1)
    S /= 100;
    V /= 100;

    // Convert HSV to RGB
    const { r, g, b } = hsvToRgb(H, S, V);

    // Return the colored string
    return `\x1b[38;2;${r};${g};${b}m${string}\x1b[0m`;
};
export const bgHsv = (H, S, V) => (string) => {
    // Convert S and V from percentage (0-100) to fraction (0-1)
    S /= 100;
    V /= 100;

    // Convert HSV to RGB
    const { r, g, b } = hsvToRgb(H, S, V);

    return `\x1b[48;2;${r};${g};${b}m${string}\x1b[0m`;
};
export const hsl = (H, S, L) => (string) => {
    // Convert HSL to RGB
    const { r, g, b } = hslToRgb(H, S, L);

    // Return the colored string with ANSI escape code
    return `\x1b[38;2;${r};${g};${b}m${string}\x1b[0m`;
};
export const bgHsl = (H, S, L) => (string = "I am bgHsl") => {
    // Convert HSL to RGB
    const { r, g, b } = hslToRgb(H, S, L);

    return `\x1b[48;2;${r};${g};${b}m${string}\x1b[0m`;
};
export const rainbow = (string = "I am rainbowed") => {
    try {
        const rainbowColors = [
            { R: 255, G: 0, B: 0 },
            { R: 255, G: 127, B: 0 },
            { R: 255, G: 255, B: 0 },
            { R: 0, G: 255, B: 0 },
            { R: 0, G: 0, B: 255 },
            { R: 75, G: 0, B: 130 },
            { R: 143, G: 0, B: 255 },
        ];
        let colorIndex = 0;
        return string
            .split("")
            .map((char) => {
                const color = rainbowColors[colorIndex];
                colorIndex = (colorIndex + 1) % rainbowColors.length;
                return rgb(color.R, color.G, color.B)(char);
            })
            .join("");
    } catch (e) {
        const error = new Error("Invalid string. Must a string");
        return "Error generating rainbowed string: " + error.message;
    }
};

export const gradientProgressBar = (progress, total, startColor, endColor) => {
    const length = 50;
    const filledLength = Math.round((progress / total) * length);
    const emptyLength = length - filledLength;

    const filledBar = Array(filledLength)
        .fill("")
        .map((_, i) => {
            const R = Math.round(startColor.R + ((endColor.R - startColor.R) * i) / (length - 1));
            const G = Math.round(startColor.G + ((endColor.G - startColor.G) * i) / (length - 1));
            const B = Math.round(startColor.B + ((endColor.B - startColor.B) * i) / (length - 1));
            return `\x1b[48;2;${R};${G};${B}m \x1b[0m`;
        })
        .join("");

    const emptyBar = " ".repeat(emptyLength);
    return `[${filledBar}${emptyBar}] ${Math.round((progress / total) * 100)}%`;
};

export const checkerboard = (width, height, colors) => {
    const [color1, color2] = colors;
    return Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) => {
            const color = (x + y) % 2 === 0 ? color1 : color2;
            return `\x1b[48;2;${color.R};${color.G};${color.B}m \x1b[0m`;
        }).join("")
    ).join("\n");
};
export const cycleColors = (text, colors, interval = 200) => {
    let colorIndex = 0;
    const animate = setInterval(() => {
        console.clear();
        const { R, G, B } = colors[colorIndex % colors.length];
        console.log(`\x1b[38;2;${R};${G};${B}m${text}\x1b[0m`);
        colorIndex++;
    }, interval);

    return () => clearInterval(animate); // Return a function to stop the animation
};

export const fireText = (text) => {
    const fireColors = [
        { R: 255, G: 0, B: 0 },
        { R: 255, G: 69, B: 0 },
        { R: 255, G: 140, B: 0 },
        { R: 255, G: 215, B: 0 },
        { R: 255, G: 255, B: 0 },
    ];
    let index = 0;
    return text
        .split("")
        .map((char) => {
            const { R, G, B } = fireColors[index];
            index = (index + 1) % fireColors.length;
            return `\x1b[38;2;${R};${G};${B}m${char}\x1b[0m`;
        })
        .join("");
};

export const rainbowAnimation = (text, interval = 100) => {
    const rainbowColors = [
        { R: 255, G: 0, B: 0 },
        { R: 255, G: 127, B: 0 },
        { R: 255, G: 255, B: 0 },
        { R: 0, G: 255, B: 0 },
        { R: 0, G: 0, B: 255 },
        { R: 75, G: 0, B: 130 },
        { R: 143, G: 0, B: 255 },
    ];
    let index = 0;

    const animate = setInterval(() => {
        const { R, G, B } = rainbowColors[index];
        index = (index + 1) % rainbowColors.length;
        console.clear();
        console.log(`\x1b[38;2;${R};${G};${B}m${text}\x1b[0m`);
    }, interval);

    return () => clearInterval(animate); // Returns a function to stop the animation
};

export const typingEffect = async (text, color = { R: 255, G: 255, B: 255 }, delay = 100) => {
    for (const char of text) {
        const { R, G, B } = color;
        process.stdout.write(`\x1b[38;2;${R};${G};${B}m${char}\x1b[0m`);
        await new Promise((resolve) => setTimeout(resolve, delay));
    }
    console.log(); // Newline after typing effect
};

export const fireworks = (text = "✨", duration = 5000, colors = [{ R: 255, G: 0, B: 0 },
    { R: 0, G: 255, B: 0 },
    { R: 0, G: 0, B: 255 },
    { R: 255, G: 255, B: 0 },
    { R: 255, G: 20, B: 147 },]) => {
    const { length } = text;
    const interval = setInterval(() => {
        console.clear();
        console.log(
            Array.from({ length: 20 }, () =>
                Array.from({ length: 50 }, () =>
                    Math.random() > 0.95
                        ? rgb(colors[Math.floor(Math.random() * colors.length)].R, colors[Math.floor(Math.random() * colors.length)].G, colors[Math.floor(Math.random() * colors.length)].B)(text[Math.floor(Math.random() * length)])
                        : " "
                ).join("")
            ).join("\n")
        );
    }, 100);

    setTimeout(() => clearInterval(interval), duration);
};

export const wave = (text = "Wave Animation!", colors = [
    { R: 255, G: 0, B: 0 },
    { R: 255, G: 127, B: 0 },
    { R: 255, G: 255, B: 0 },
    { R: 0, G: 255, B: 0 },
    { R: 0, G: 0, B: 255 },
    { R: 75, G: 0, B: 130 },
    { R: 143, G: 0, B: 255 },
], speed = 100) => {
    let frame = 0;
    const animate = setInterval(() => {
        console.clear();
        console.log(
            text
                .split("")
                .map((char, i) => {
                    const colorIndex = Math.round(Math.sin((frame + i) * 0.2) * (colors.length / 2 - 1) + colors.length / 2);
                    const { R, G, B } = colors[colorIndex % colors.length];
                    return `\x1b[38;2;${R};${G};${B}m${char}\x1b[0m`;
                })
                .join("")
        );
        frame++;
    }, speed);

    return () => clearInterval(animate); // Return a function to stop the animation
};

export const gradient = (text = "Gradient", startColor = { R: 255, G: 0, B: 0 }, endColor = { R: 0, G: 0, B: 255 }) => {
    // Ensure text is valid
    if (typeof text !== "string" || text.length === 0) {
        throw new Error("Invalid text input. Must be a non-empty string.");
    }

    // Validate and apply default colors
    startColor = startColor && typeof startColor === "object" && "R" in startColor && "G" in startColor && "B" in startColor ? startColor : { R: 255, G: 0, B: 0 };
    endColor = endColor && typeof endColor === "object" && "R" in endColor && "G" in endColor && "B" in endColor ? endColor : { R: 0, G: 0, B: 255 };

    //console.log("Validated Inputs:", { text, startColor, endColor });

    // Calculate gradient
    const length = text.length;
    return text
        .split("")
        .map((char, i) => {
            const R = Math.round(startColor.R + ((endColor.R - startColor.R) * i) / (length - 1));
            const G = Math.round(startColor.G + ((endColor.G - startColor.G) * i) / (length - 1));
            const B = Math.round(startColor.B + ((endColor.B - startColor.B) * i) / (length - 1));
            return `\x1b[38;2;${R};${G};${B}m${char}\x1b[0m`;
        })
        .join("");
};

export const random = (string) => {
    const R = Math.floor(Math.random() * 256);
    const G = Math.floor(Math.random() * 256);
    const B = Math.floor(Math.random() * 256);
    return rgb(R, G, B)(string);
};

export const glitch = (
    text = "Glitch Effect!",
    duration = 5000,
    colors = [
        { R: 0, G: 255, B: 255 },
        { R: 255, G: 0, B: 255 },
        { R: 255, G: 255, B: 0 },
    ]
) => {
    const { length } = text;
    const interval = setInterval(() => {
        console.clear();
        console.log(
            text
                .split("")
                .map((char, i) =>
                    Math.random() > 0.7
                        ? rgb(
                              colors[Math.floor(Math.random() * colors.length)].R,
                              colors[Math.floor(Math.random() * colors.length)].G,
                              colors[Math.floor(Math.random() * colors.length)].B
                          )(String.fromCharCode(Math.floor(Math.random() * 94) + 33))
                        : rgb(colors[Math.floor(Math.random() * colors.length)].R, colors[Math.floor(Math.random() * colors.length)].G, colors[Math.floor(Math.random() * colors.length)].B)(char)
                )
                .join("")
        );
    }, 100);

    setTimeout(() => clearInterval(interval), duration);
};
export const asciiArtColor = (
    art = `
  *****
 *     *
*       *
 *     *
  *****
`,
    colors = [
        { R: 255, G: 0, B: 0 },
        { R: 0, G: 255, B: 0 },
        { R: 0, G: 0, B: 255 },
    ]
) => {
    try {
        const lines = art.split("\n");
        return lines
            .map((line, i) =>
                line
                    .split("")
                    .map((char, j) => {
                        const color = colors[(i + j) % colors.length];
                        return `\x1b[38;2;${color.R};${color.G};${color.B}m${char}\x1b[0m`;
                    })
                    .join("")
            )
            .join("\n");
    } catch (e) {
        const error = new Error("color arguement (second argument) must be an array of objects with R, G, and B properties");
        // console.error("Error generating ASCII art:", error.message);
        return "Error generating ASCII art: " + error.message;
    }
};
export const shadowText = (text =  "Shadowed!", color =    { R: 0, G: 255, B: 0 }, shadowColor = { R: 50, G: 50, B: 50 }, offset = 1) => {
    // Validate color inputs
    if (!color || !shadowColor || typeof color !== "object" || typeof shadowColor !== "object") {
        throw new Error("Both color and shadowColor must be objects with R, G, and B properties.");
    }

    // Generate the shadow with horizontal offset
    const shadow = text
        .split("")
        .map((char) => `\x1b[38;2;${shadowColor.R};${shadowColor.G};${shadowColor.B}m${char}\x1b[0m`)
        .join("");

    // Generate the main colored text
    const coloredText = text
        .split("")
        .map((char) => `\x1b[38;2;${color.R};${color.G};${color.B}m${char}\x1b[0m`)
        .join("");

    // Create shadow lines with vertical offset
    const shadowLines = Array.from({ length: offset }, () => " ".repeat(offset) + shadow).join("\n");

    // Combine shadow and text
    return `${shadowLines}\n${coloredText}`;
};
export const fireAnimation = (text = "Fire Animation Text", colors, speed = 100) => {
    const fireColors = colors || [
        { R: 255, G: 0, B: 0 },
        { R: 255, G: 69, B: 0 },
        { R: 255, G: 140, B: 0 },
        { R: 255, G: 215, B: 0 },
        { R: 255, G: 255, B: 0 },
    ];

    const animate = setInterval(() => {
        console.clear();
        console.log(
            text
                .split("")
                .map((char) => {
                    const { R, G, B } = fireColors[Math.floor(Math.random() * fireColors.length)];
                    return `\x1b[38;2;${R};${G};${B}m${char}\x1b[0m`;
                })
                .join("")
        );
    }, speed);

    return () => clearInterval(animate);
};
export const raindrops = (text = "Rain Drops Text", colors = [
  { R: 0, G: 255, B: 0 },
  { R: 50, G: 255, B: 50 },
  { R: 0, G: 128, B: 0 },
], speed = 100) => {
  if (!Array.isArray(colors) || colors.some((color) => typeof color!== "object" ||!("R" in color && "G" in color && "B" in color))) {
    throw new Error("Invalid color array. Must be an array of objects with R, G, and B properties.");
  }
  if (typeof text !== "string") {
    throw new Error("Invalid text. Must be a string.");
  }
  if (typeof speed!== "number" || speed <= 0) {
    throw new Error("Invalid speed. Must be a positive number.");
  }
    const { length } = text;
    const drops = Array(length).fill(false); // Tracks active drops

    const animate = setInterval(() => {
        console.clear();
        console.log(
            Array.from({ length: 20 }, () =>
                text
                    .split("")
                    .map((char, i) => {
                        if (Math.random() > 0.95) drops[i] = true; // Activate drop randomly
                        if (drops[i]) {
                            const { R, G, B } = colors[Math.floor(Math.random() * colors.length)];
                            return `\x1b[38;2;${R};${G};${B}m${char}\x1b[0m`;
                        }
                        return " ";
                    })
                    .join("")
            ).join("\n")
        );
    }, speed);

    return () => clearInterval(animate); // Stop animation
};
export const circularText = (text = "Circular", radius = 3, color = { R: 255, G: 0, B: 0 }) => {
    if (!color || typeof color !== "object" || !("R" in color && "G" in color && "B" in color)) {
        throw new Error("Invalid color. Must be an object with R, G, and B properties.");
    }

    try {
        const centerY = radius; // Center of the circle in rows
        const centerX = radius; // Center of the circle in columns

        // Create a grid to place characters
        const grid = Array.from({ length: radius * 2 + 1 }, () => Array(radius * 2 + 1).fill(" "));

        // Place characters on the circular path
        text.split("").forEach((char, i) => {
            const angle = (i / text.length) * 2 * Math.PI; // Calculate angle for the character
            const x = Math.round(centerX + radius * Math.cos(angle)); // X-coordinate
            const y = Math.round(centerY + radius * Math.sin(angle)); // Y-coordinate

            if (grid[y] && grid[y][x]) {
                grid[y][x] = `\x1b[38;2;${color.R};${color.G};${color.B}m${char}\x1b[0m`;
            }
        });

        // Convert the grid to a string
        return grid.map((row) => row.join("")).join("\n");
    } catch (e) {
        const error = new Error("An Error occurred while converting the grid to a string");
        return "Error generating circular text: " + error.message;
    }
};
export const glow = (text = "Glowing Text", centerColor = { R: 255, G: 255, B: 0 }, outerColor = { R: 50, G: 50, B: 50 }, intensity = 3) => {
    if (!centerColor || typeof centerColor !== "object" || !("R" in centerColor && "G" in centerColor && "B" in centerColor)) {
        throw new Error("Invalid centerColor. Must be an object with R, G, and B properties.");
    }
    if (!outerColor || typeof outerColor !== "object" || !("R" in outerColor && "G" in outerColor && "B" in outerColor)) {
        throw new Error("Invalid outerColor. Must be an object with R, G, and B properties.");
    }
    try {
        const length = text.length;
        return text
            .split("")
            .map((char, i) => {
                const distance = Math.abs(length / 2 - i) / (length / 2); // Normalized distance from center
                const R = Math.round(centerColor.R + (outerColor.R - centerColor.R) * distance * intensity);
                const G = Math.round(centerColor.G + (outerColor.G - centerColor.G) * distance * intensity);
                const B = Math.round(centerColor.B + (outerColor.B - centerColor.B) * distance * intensity);
                return `\x1b[38;2;${R};${G};${B}m${char}\x1b[0m`;
            })
            .join("");
    } catch (e) {
        const error = new Error("An Error occurred while validating the input parameters");
        return "Error generating glowing text: " + error.message;
    }
};
export const pulse = (text = "Pulsing!", color = { R: 0, G: 128, B: 255 }, speed = 100) => {
    if (!color || typeof color !== "object" || !("R" in color && "G" in color && "B" in color)) {
        throw new Error("Invalid color. Must be an object with R, G, and B properties.");
    }
    if (typeof text !== "string") {
        throw new Error("Invalid text. Must be a string.");
    }
    if (typeof speed !== "number") {
        throw new Error("Invalid speed. Must be a number.");
    }
    try {
        let direction = 1; // 1 = brighter, -1 = darker
        let brightness = 1; // From 0.1 to 1

        const animate = setInterval(() => {
            console.clear();
            const adjustedColor = {
                R: Math.round(color.R * brightness),
                G: Math.round(color.G * brightness),
                B: Math.round(color.B * brightness),
            };
            console.log(
                text
                    .split("")
                    .map((char) => `\x1b[38;2;${adjustedColor.R};${adjustedColor.G};${adjustedColor.B}m${char}\x1b[0m`)
                    .join("")
            );

            brightness += 0.1 * direction;
            if (brightness >= 1 || brightness <= 0.1) direction *= -1; // Reverse direction
        }, speed);

        return () => clearInterval(animate); // Return a function to stop the pulse
    } catch (e) {
        const error = new Error("An Error occurred while validating the input parameters");
        return "Error generating pulsing text: " + error.message;
    }
};
export const threeDText = (text = "3D!", baseColor = { R: 255, G: 50, B: 50 }, depth = 0) => {
    if (!baseColor || typeof baseColor !== "object" || !("R" in baseColor && "G" in baseColor && "B" in baseColor)) {
        throw new Error("Invalid baseColor. Must be an object with R, G, and B properties.");
    }
    if (typeof text !== "string") {
        throw new Error("Invalid text. Must be a string.");
    }
    if (typeof depth !== "number") {
        throw new Error("Invalid depth. Must be a number.");
    }

    try {
        const layers = [];
        for (let i = 0; i < depth; i++) {
            const factor = (depth - i) / depth; // Gradually darken
            const R = Math.round(baseColor.R * factor);
            const G = Math.round(baseColor.G * factor);
            const B = Math.round(baseColor.B * factor);
            layers.push(
                " ".repeat(i) +
                    text
                        .split("")
                        .map((char) => `\x1b[38;2;${R};${G};${B}m${char}\x1b[0m`)
                        .join("")
            );
        }
        layers.push(
            text
                .split("")
                .map((char) => `\x1b[38;2;${baseColor.R};${baseColor.G};${baseColor.B}m${char}\x1b[0m`)
                .join("")
        );
        return layers.join("\n");
    } catch (e) {
        const error = new Error("An Error occurred while validating the input parameters");
        return "Error generating 3D text: " + error.message;
    }
};

export const fadeText = (text = "Fading Text!", color = { R: 0, G: 255, B: 128 }, fadeIn = true, speed = 100) => {
    if (!color || typeof color !== "object" || !("R" in color && "G" in color && "B" in color)) {
        throw new Error("Invalid color. Must be an object with R, G, and B properties.");
    }
    if (typeof text !== "string") {
        throw new Error("Invalid text. Must be a string.");
    }
    if (typeof fadeIn !== "boolean") {
        throw new Error("Invalid fadeIn. Must be a boolean.");
    }
    if (typeof speed !== "number") {
        throw new Error("Invalid speed. Must be a number.");
    }
    try {
        let visibleChars = fadeIn ? 0 : text.length;

        const animate = setInterval(() => {
            console.clear();
            console.log(
                text
                    .split("")
                    .map((char, i) => (i < visibleChars ? `\x1b[38;2;${color.R};${color.G};${color.B}m${char}\x1b[0m` : "\x1b[38;2;50;50;50m \x1b[0m"))
                    .join("")
            );
            visibleChars += fadeIn ? 1 : -1;
            if (visibleChars > text.length || visibleChars < 0) clearInterval(animate); // Stop animation
        }, speed);
    } catch (e) {
        const error = new Error("An Error occurred while validating the input parameters");
        return "Error generating fading text: " + error.message;
    }
};

// Chaining API for styling (like Chalk)
export const chain = function (string) {
    if (typeof string === "string") {
        throw new Error("Invalid input. Must be a string.");
    }
    let styledString = string;
    const self = {
        string: () => styledString,
    };

    for (const [key, func] of Object.entries(wrappedColors)) {
        self[key] = () => {
            styledString = func(styledString);
            return self;
        };
    }
    self.rgb = (R, G, B) => {
        if (typeof R !== "number" || typeof G !== "number" || typeof B !== "number") {
            throw new Error("Invalid RGB values. Must R, G, and B values be specified");
        }

        styledString = rgb(R, G, B)(styledString);
        return self;
    };
    self.bgRgb = (R, G, B) => {
        if (typeof R !== "number" || typeof G !== "number" || typeof B !== "number") {
            throw new Error("Invalid RGB values. Must R, G, and B values be specified");
        }
        styledString = bgRgb(R, G, B)(styledString);
        return self;
    };

    return self;
};



export const gradientText = (text = "Gradient", startColor = { R: 255, G: 0, B: 0 }, endColor = { R: 0, G: 0, B: 255 }) => {
    // Ensure text is valid
    if (typeof text !== "string" || text.length === 0) {
        throw new Error("Invalid text input. Must be a non-empty string.");
    }

    // Validate and apply default colors
    startColor = startColor && typeof startColor === "object" && "R" in startColor && "G" in startColor && "B" in startColor ? startColor : { R: 255, G: 0, B: 0 };
    endColor = endColor && typeof endColor === "object" && "R" in endColor && "G" in endColor && "B" in endColor ? endColor : { R: 0, G: 0, B: 255 };

    //console.log("Validated Inputs:", { text, startColor, endColor });

    // Calculate gradient
    const length = text.length;
    return text
        .split("")
        .map((char, i) => {
            const R = Math.round(startColor.R + ((endColor.R - startColor.R) * i) / (length - 1));
            const G = Math.round(startColor.G + ((endColor.G - startColor.G) * i) / (length - 1));
            const B = Math.round(startColor.B + ((endColor.B - startColor.B) * i) / (length - 1));
            return `\x1b[38;2;${R};${G};${B}m${char}\x1b[0m`;
        })
        .join("");
};


// Set theme
export const setTheme = (theme) => {
    // console.log("Setting theme:", theme); // Check function execution
    if (!themes[theme]) {
        throw new Error(`Invalid theme: ${theme}`);
    }

    // Apply the theme
    // console.log("Applying theme:", theme); // Check function execution
    // console.log("Theme:", couleurs().themes[theme]); // Check function execution
    // console.log("Current theme:", currentTheme); // Check function execution
    if (currentTheme) {
        // Reset colors to default
        applyColor(reset)();
    }
    // Apply the new theme
    applyColor(themes[theme])();
    // Update the current theme
    // console.log("New current theme:", couleurs().themes[theme]); // Check function execution
    // console.log("Current theme:", currentTheme); // Check function execution
    // console.log("---------------------------"); // Check function execution
    // console.log(""); // Check function execution
    currentTheme = themes[theme] || null;
};

// Contextual Color Selection (status-based)
export const statusColor = (status, message) => {// TODO: not working 


    // console.log('colors ....', wrappedColors.cyan(message));
    //return wrappedColors.red(wrappedColors.bold(message))

    if (typeof status !== "string" || typeof message !== "string") {
        throw new Error("Invalid status or message. Both must be strings.");
    }
    try {
        const colorMap = currentTheme || {
            success: wrappedColors.green,
            error: wrappedColors.red,
            warning: wrappedColors.yellow,
            info: wrappedColors.blue,
            debug: wrappedColors.cyan,
            notice: wrappedColors.purple,
            neutral: wrappedColors.white,
            alert: wrappedColors.magenta,
            critical: wrappedColors.bold, // Bold red for critical issues
        };
        if(status === "critical") {
            return wrappedColors.red(wrappedColors.bold(message))
        }
        const  colorFunction = colorMap[status] || wrappedColors.white;
        return colorFunction(message) || applyColor(colorFunction)(message);
    } catch (e) {
        const error = new Error("An Error occurred while validating the input parameters");
        return "Error generating status color: " + error.message;
    }
};

// Enable/Disable colors
export const setUseColors = (value) => {
    useColors = Boolean(value);
};

// Set default RGB configuration
export const setDefaultRGB = (R, G, B) => {
    if (Number.isInteger(R)) defaultRGBConfig.R = R;
    if (Number.isInteger(G)) defaultRGBConfig.G = G;
    if (Number.isInteger(B)) defaultRGBConfig.B = B;
};

export const horizontalGradient = (text = "Horizontal Gradient ", startColor = { R: 0, G: 255, B: 0 }, endColor = { R: 0, G: 255, B: 128 }) => {
    // console.log("Running horizontal gradient"); // Check function execution

    if (!startColor || typeof startColor !== "object" || !("R" in startColor && "G" in startColor && "B" in startColor)) {
        throw new Error("Invalid startColor. Must be an object with R, G, and B properties.");
    }
    if (!endColor || typeof endColor !== "object" || !("R" in endColor && "G" in endColor && "B" in endColor)) {
        throw new Error("Invalid endColor. Must be an object with R, G, and B properties.");
    }
    if (typeof text !== "string") {
        throw new Error("Invalid text. Must be a string.");
    }
    if (!text.length) return text;

    try {
        const { length } = text;
        const gradientText = Array.from(text).map((char, i) => {
            const ratio = i / (length - 1);
            const r = Math.round(startColor.R * (1 - ratio) + endColor.R * ratio);
            const g = Math.round(startColor.G * (1 - ratio) + endColor.G * ratio);
            const b = Math.round(startColor.B * (1 - ratio) + endColor.B * ratio);
            return `\x1b[38;2;${r};${g};${b}m${char}\x1b[0m`;
        });

        // console.log("Gradient Text Array (Horizontal):", gradientText); // Debug output
        return gradientText.join("");
    } catch (e) {
        const error = new Error("An Error occurred while validating the input parameters");
        return "Error generating horizontal gradient: " + error.message;
    }
};

export const verticalGradient = (textLines = [], startColor = { R: 0, G: 255, B: 0 }, endColor = { R: 0, G: 255, B: 128 }) => {
    // console.log("Running vertical gradient"); // Check function execution
    if (!startColor || typeof startColor !== "object" || !("R" in startColor && "G" in startColor && "B" in startColor)) {
        throw new Error("Invalid startColor. Must be an object with R, G, and B properties.");
    }
    if (!endColor || typeof endColor !== "object" || !("R" in endColor && "G" in endColor && "B" in endColor)) {
        throw new Error("Invalid endColor. Must be an object with R, G, and B properties.");
    }
    if (!Array.isArray(textLines) || !textLines.every((line) => typeof line === "string")) {
        throw new Error("Invalid textLines. Must be an array of strings.");
    }

    if (!textLines.length) return "";

    try {
        const { length } = textLines;
        const gradientLines = textLines.map((line, i) => {
            const ratio = i / (length - 1);
            const r = Math.round(startColor.R * (1 - ratio) + endColor.R * ratio);
            const g = Math.round(startColor.G * (1 - ratio) + endColor.G * ratio);
            const b = Math.round(startColor.B * (1 - ratio) + endColor.B * ratio);
            return `\x1b[38;2;${r};${g};${b}m${line}\x1b[0m`;
        });

        // console.log("Gradient Lines Array (Vertical):", gradientLines); // Debug output
        return gradientLines.join("\n");
    } catch (e) {
        const error = new Error("An Error occurred while validating the input parameters");
        return "Error generating vertical gradient: " + error.message;
    }
};
export const multiColorGradient = (text = "Multi Color Gradient", colors = []) => {
    // console.log("Running multi-color gradient"); // Check function execution
    if (!Array.isArray(colors) || !colors.every((color) => typeof color === "object" && "R" in color && "G" in color && "B" in color)) {
        throw new Error("Invalid colors. Must be an array of objects with R, G, and B properties.");
    }
    if (typeof text !== "string") {
        throw new Error("Invalid text. Must be a string.");
    }
    if (!text.length || colors.length < 2) return text;

    try {
        const numSegments = colors.length - 1;
        const segmentLength = Math.floor(text.length / numSegments);
        const gradientText = Array.from(text).map((char, i) => {
            const segmentIndex = Math.min(Math.floor(i / segmentLength), numSegments - 1); // Ensure within bounds
            const startColor = colors[segmentIndex];
            const endColor = colors[segmentIndex + 1] || startColor; // Fallback to startColor if endColor is undefined

            // Calculate the position within the current segment
            const segmentPos = (i % segmentLength) / segmentLength;
            const r = Math.round(startColor.R * (1 - segmentPos) + endColor.R * segmentPos);
            const g = Math.round(startColor.G * (1 - segmentPos) + endColor.G * segmentPos);
            const b = Math.round(startColor.B * (1 - segmentPos) + endColor.B * segmentPos);

            return `\x1b[38;2;${r};${g};${b}m${char}\x1b[0m`;
        });

        // console.log("Gradient Text Array (Multi-Color):", gradientText); // Debug output
        return gradientText.join("");
    } catch (e) {
        const error = new Error("An Error occurred while validating the input parameters");
        return "Error generating multi-color gradient: " + error.message;
    }
};

export const boxText = (text, style = "single", padding = 1, options = {}) => {
    // console.log("Running box text"); // Check function execution
    if (typeof text !== "string") {
        throw new Error("Invalid text. Must be a string.");
    }
    if (typeof style !== "string" || !Object.keys(borderStyles).includes(style)) {
        throw new Error("Invalid style. Must be one of: " + Object.keys(borderStyles).join(", "));
    }
    if (typeof padding !== "number" || padding < 0) {
        throw new Error("Invalid padding. Must be a positive number.");
    }
    if (typeof options !== "object") {
        throw new Error("Invalid options. Must be an object.");
    }

    // Set default options
    // const defaultCorners = { topLeft: false, topRight: false, bottomLeft: false, bottomRight: false };
    // const defaultColors = { textColor: "", borderColor: "" };
    // const defaultShadow = false;
    // const defaultGradient = false;

    // const { topLeft, topRight, bottomLeft, bottomRight } = {
    //  ...defaultCorners,
    //  ...options.customCorners,
    // };

    try {
        const borderStyles = {
            single: { top: "─", side: "│", topLeft: "┌", topRight: "┐", bottomLeft: "└", bottomRight: "┘" },
            double: { top: "═", side: "║", topLeft: "╔", topRight: "╗", bottomLeft: "╚", bottomRight: "╝" },
            dashed: { top: "-", side: "|", topLeft: "+", topRight: "+", bottomLeft: "+", bottomRight: "+" },
            dotted: { top: ".", side: ":", topLeft: ":", topRight: ":", bottomLeft: ":", bottomRight: ":" },
            rounded: { top: "─", side: "│", topLeft: "╭", topRight: "╮", bottomLeft: "╰", bottomRight: "╯" },
            heavy: { top: "━", side: "┃", topLeft: "┏", topRight: "┓", bottomLeft: "┗", bottomRight: "┛" },
            doubleRounded: { top: "═", side: "║", topLeft: "╒", topRight: "╕", bottomLeft: "╘", bottomRight: "╛" },
        };

        const { textColor = "", borderColor = "", shadow = false, customCorners = {}, gradient = false, paddingTop = padding, paddingBottom = padding, paddingLeft = padding, paddingRight = padding } = options;

        const { top, side, topLeft, topRight, bottomLeft, bottomRight } = {
            ...(borderStyles[style] || borderStyles.single),
            ...customCorners,
        };

        const applyColor = (str, color) => (color ? `${color}${str}\x1b[0m` : str);

        const lines = text.split("\n");
        const maxLength = Math.max(...lines.map((line) => line.length));
        const boxWidth = maxLength + paddingLeft + paddingRight;

        const createGradientBorder = (borderChar, length) => {
            let coloredBorder = "";
            for (let i = 0; i < length; i++) {
                const gradientColor = gradient ? couleurs().rgb(150 + i * 2, 50 + i * 3, 255 - i * 4) : borderColor;
                coloredBorder += applyColor(borderChar, gradientColor);
            }
            return coloredBorder;
        };

        const topBorder = applyColor(topLeft, borderColor) + createGradientBorder(top, boxWidth) + applyColor(topRight, borderColor);
        const bottomBorder = applyColor(bottomLeft, borderColor) + createGradientBorder(top, boxWidth) + applyColor(bottomRight, borderColor);

        const paddedLines = lines.map((line) => applyColor(side, borderColor) + " ".repeat(paddingLeft) + applyColor(line.padEnd(maxLength), textColor) + " ".repeat(paddingRight) + applyColor(side, borderColor));

        const boxWithPadding = [
            topBorder,
            ...Array(paddingTop).fill(applyColor(side + " ".repeat(boxWidth) + side, borderColor)),
            ...paddedLines,
            ...Array(paddingBottom).fill(applyColor(side + " ".repeat(boxWidth) + side, borderColor)),
            bottomBorder,
        ];

        if (shadow) {
            boxWithPadding.push(" ".repeat(boxWidth + 2) + "\u2592");
        }

        return boxWithPadding.join("\n");
    } catch (e) {
        const error = new Error("An Error occurred while validating the input parameters");
        return "Error generating box text: " + error.message;
    }
};

export const blinkingText = (text = "blinking text", color1 = "red", color2 = "white", interval = 500, stopBlinking = false) => {
    // console.log("Running blinking text"); // Check function execution
    if (typeof text !== "string") {
        throw new Error("Invalid text. Must be a string.");
    }
    if (color1 && typeof color1 !== "string" && !Array.isArray(color1)) {
        throw new Error("Invalid color1. Must be a string or an array of rgb color values.");
    }
    if (color2 && typeof color2 !== "string" && !Array.isArray(color2)) {
        throw new Error("Invalid color2. Must be a string or an array of rgb color values.");
    }
    if ((interval && typeof interval !== "number") || interval <= 0) {
        throw new Error("Invalid interval. Must be a positive number.");
    }
    if (stopBlinking && typeof stopBlinking !== "boolean") {
        throw new Error("Invalid stopBlinking. Must be a boolean.");
    }

    // console.log("Running blinking text"); // Check function execution

    if (!color1 in wrappedColors) {
        throw new Error("Invalid color1. Must be a valid color name or an array of rgb color values.");
    }
    if (!color2 in wrappedColors) {
        throw new Error("Invalid color2. Must be a valid color name or an array of rgb color values.");
    }

    try {
        let currentColor = true;
        let colorFunc1, colorFunc2;
        if (color1 && Array.isArray(color1)) {
            if (color1.length === 1) {
                colorFunc1 = rgb(color1[0], 0, 0);
            } else if (color1.length === 2) {
                colorFunc1 = rgb(color1[0], color1[1], 0);
            } else if (color1.length === 3) {
                colorFunc1 = rgb(color1[0], color1[1], color1[2]);
            } else {
                throw new Error("Invalid color1 input: must be a string or an array of rgb color values");
            }
        } else {
            colorFunc1 = wrappedColors[color1] || wrappedColors.red;
        }

        if (color2 && Array.isArray(color2)) {
            if (color2.length === 1) {
                colorFunc2 = rgb(color2[0], 0, 0);
            } else if (color2.length === 2) {
                colorFunc2 = rgb(color2[0], color2[1], 0);
            } else if (color2.length === 3) {
                colorFunc2 = rgb(color2[0], color2[1], color2[2]);
            } else {
                throw new Error("Invalid color2 input: must be a string or an array of rgb color values");
            }
        } else {
            colorFunc2 = wrappedColors[color2] || wrappedColors.white;
        }

        // colorFunc1 = couleurs[color1] || couleurs.red;
        // colorFunc2 = couleurs[color2] || couleurs.white;

        const blinkInterval = setInterval(() => {
            process.stdout.write(`\r${currentColor ? colorFunc1(text) : colorFunc2(text)}`);
            currentColor = !currentColor;
        }, interval);

        if (stopBlinking && stopBlinking === true) return;

        //Stop blinking after a specified duration
        setTimeout(() => clearInterval(blinkInterval), interval * 10);
    } catch (e) {
        const error = new Error("An Error occurred while validating the input parameters");
        return "Error generating blinking text: " + error.message;
    }
};

export const typewriterEffect = (text = "Type Writer Effect", interval = 100) => {
    // console.log("Running typewriter effect"); // Check function execution
    if (typeof text !== "string") {
        throw new Error("Invalid text. Must be a string.");
    }
    if ((interval && typeof interval !== "number") || interval <= 0) {
        throw new Error("Invalid interval. Must be a positive number.");
    }

    try {
        let index = 0;
        const typingInterval = setInterval(() => {
            if (index < text.length) {
                process.stdout.write(text[index]);
                index++;
            }
        }, interval);

        setTimeout(() => clearInterval(typingInterval), interval * text.length);
    } catch (e) {
        const error = new Error("An Error occurred while validating the input parameters");
        return "Error generating typewriter effect: " + error.message;
    }

    // let index = 0;

    // const typingInterval = setInterval(() => {
    //     if (index < text.length) {
    //         process.stdout.write(text[index]);
    //         index++;
    //     } else {
    //         clearInterval(typingInterval);
    //         process.stdout.write("\n");
    //     }
    // }, interval);
};

export const createProgressBar = ({
    total = 100,
    current = 0,
    length = 30,
    completeChar = "█",
    incompleteChar = "-",
    color = { R: 0, G: 255, B: 0 }, // Default green for progress
    bgColor = { R: 100, G: 100, B: 100 }, // Gray for background
    endColor = { R: 0, G: 128, B: 255 }, // Blue for gradient end
    displayPercentage = true,
    gradient = false,
    patternInterval = 0, // Set a pattern interval, e.g., 2
    animation = false,
} = {}) => {
    const applyColor = (text, { R, G, B }) => `\x1b[38;2;${R};${G};${B}m${text}\x1b[0m`;

    const getGradientColor = (progressIndex) => {
        const factor = progressIndex / length;
        const r = Math.round(color.R * (1 - factor) + endColor.R * factor);
        const g = Math.round(color.G * (1 - factor) + endColor.G * factor);
        const b = Math.round(color.B * (1 - factor) + endColor.B * factor);
        return { R: r, G: g, B: b };
    };

    const calculateProgress = () => {
        const percentage = (current / total) * 100;
        const progressLength = Math.round((current / total) * length);
        const remainingLength = length - progressLength;

        // Construct progress and remaining parts
        let progress = "";
        for (let i = 0; i < progressLength; i++) {
            const char = patternInterval && i % patternInterval === 0 ? completeChar : incompleteChar;
            const charColor = gradient ? getGradientColor(i) : color;
            progress += applyColor(char, charColor);
        }

        const remaining = applyColor(incompleteChar.repeat(remainingLength), bgColor);
        let bar = `${progress}${remaining}`;

        // Add percentage display
        if (displayPercentage) {
            bar += ` ${Math.round(percentage)}%`;
        }

        return bar;
    };

    const animate = () => {
        const frames = ["|", "/", "-", "\\"];
        let index = 0;
        const interval = setInterval(() => {
            process.stdout.write(`\r${frames[index++ % frames.length]} ${calculateProgress()}`);
            current = (current + 1) % total;
        }, 100);
        return () => clearInterval(interval);
    };

    return {
        update(newCurrent) {
            current = newCurrent <= total ? newCurrent : total;
            console.clear();
            console.log(calculateProgress());
        },
        startAnimation() {
            if (animation) return animate();
        },
        stopAnimation(stopFunc) {
            if (animation && stopFunc) stopFunc();
        },
    };
};

export const getMetrics = () => {
    const memoryUsage = process.memoryUsage();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const cpuLoad = os.loadavg()[0]; // 1-minute CPU load average
    const uptime = os.uptime();

    return {
        memory: {
            used: memoryUsage.heapUsed,
            total: totalMemory,
            free: freeMemory,
        },
        cpu: {
            load: cpuLoad,
            cores: os.cpus().length,
        },
        uptime,
    };
};

// UPDATED — ESM safe
export const memoryUsed = () => getMetrics().memory.used;
export const memoryTotal = () => getMetrics().memory.total;
export const memoryFree = () => getMetrics().memory.free;
export const cpuLoad = () => getMetrics().cpu.load;
export const cpuCores = () => getMetrics().cpu.cores;
export const uptime = () => getMetrics().uptime;

export const memoryProgressBar = (used = memoryUsed(), total = memoryTotal()) => {
    const percentage = (used / total) * 100;
    const barLength = 20;
    const filledLength = Math.round((percentage / 100) * barLength);
    const bar = "█".repeat(filledLength) + "░".repeat(barLength - filledLength);

    const color =
        percentage < 50
            ? "\x1b[32m" // Green
            : percentage < 75
            ? "\x1b[33m" // Yellow
            : "\x1b[31m"; // Red

    return `${color}${bar} ${percentage.toFixed(1)}%\x1b[0m`;
};

export const checkAlerts = (metrics) => {
    if (metrics.cpu.load > metrics.cpu.cores * 0.7) {
        console.log("\x1b[31m[ALERT] High CPU Usage!\x1b[0m");
    }

    if (metrics.memory.used / metrics.memory.total > 0.8) {
        console.log("\x1b[31m[ALERT] High Memory Usage!\x1b[0m");
    }
};

export const displayMetricsDashboard = () => {
    setInterval(() => {
        console.clear();
        //const metrics = getMetrics();
        const metrics = getMetrics();

        console.log(`\x1b[36mServer Metrics Dashboard\x1b[0m`);
        console.log(`\x1b[32mCPU Load:\x1b[0m`);
        console.log(`    \x1b[33m${metrics.cpu.load.toFixed(2)}\x1b[0m (cores: ${metrics.cpu.cores})`);

        console.log(`\x1b[32mMemory Usage:\x1b[0m`);
        console.log(`    ${memoryProgressBar(metrics.memory.used, metrics.memory.total)}`);

        console.log(`\x1b[32mUptime:\x1b[0m`);
        console.log(`    \x1b[34m${Math.floor(metrics.uptime / 60)} minutes\x1b[0m`);

        console.log(`\x1b[32mTotal HTTP Requests:\x1b[0m`);
        // console.log(`    \x1b[33m${requestCount}\x1b[0m`);

        // Check for alerts
        console.log(`    ${memoryProgressBar(metrics.memory.used, metrics.memory.total)}`);
        checkAlerts(metrics);
    }, 1000);
};


/// ==== Upgraded Functions




/// ===== Addition


/* ─────────────────────────────────────────────────────────────
 * Collect all exports into a single object for default export
 * ────────────────────────────────────────────────────────────*/

const originalObject = {
    useColors,
    wrappedColors,
    themes,

    applyColor,
    applyDefaults,
    rgb,
    bgRgb,

    /* Add every function you export above (IMPORTANT) */
    trendWave,
    cryptoWave,
    weatherWave,
    stockWave,
    cpuWave,
    gridWave,
    circularWave,
    fadingWave,
    asciiArtWave,
    waveMatrix,
    combinedWave,
    bgWave,
    colorWave,
    dynamicWave,
    dashboard,
    lineChart,
    barChart,
    progressBar,
    spinner,
    gradientBox,
    interactiveTyping,
    sparkle,
    wavy,
    animatedRainbow,
    bgGradient,
    scroll,
    type,
    blink,
    gradient,
    random,
    glitch,
    asciiArtColor,
    shadowText,
    fireAnimation,
    raindrops,
    circularText,
    glow,
    pulse,
    threeDText,
    fadeText,
    typewriterEffect,
    createProgressBar,
    statusColor,
    setDefaultRGB,
    setUseColors,
    setTheme,

    horizontalGradient,
    verticalGradient,
    multiColorGradient,
    boxText,

    memoryUsed,
    memoryTotal,
    memoryFree,
    cpuLoad,
    cpuCores,
    uptime,
    range,
    realTimeChart,
    memoryProgressBar,
    checkAlerts,
    displayMetricsDashboard,
};

/* ─────────────────────────────────────────────────────────────
 * Default export (fixes your import error!)
 * ────────────────────────────────────────────────────────────*/

export default originalObject;
