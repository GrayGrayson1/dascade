/**
 * Built-in DASketch word bank. Every word is drawable, work-appropriate and free of
 * brand names. Words are lowercase; multi-word entries are allowed (the hint shows gaps).
 */
import type { SketchCategoryId } from '@dascade/shared/games/dasketch';

export const WORD_BANK: Readonly<Record<SketchCategoryId, readonly string[]>> = {
  animals: [
    'cat', 'dog', 'elephant', 'giraffe', 'penguin', 'octopus', 'kangaroo', 'turtle', 'rabbit', 'snake',
    'owl', 'lion', 'tiger', 'zebra', 'monkey', 'frog', 'shark', 'whale', 'dolphin', 'butterfly',
    'spider', 'snail', 'bee', 'ladybug', 'crab', 'lobster', 'jellyfish', 'flamingo', 'peacock', 'parrot',
    'eagle', 'duck', 'chicken', 'cow', 'pig', 'horse', 'sheep', 'goat', 'camel', 'hippo',
    'rhino', 'bear', 'panda', 'koala', 'fox', 'wolf', 'deer', 'moose', 'squirrel', 'hedgehog',
    'bat', 'mouse', 'hamster', 'seal', 'walrus', 'starfish', 'seahorse', 'dinosaur', 'unicorn', 'llama',
    'sloth', 'raccoon', 'crocodile', 'ostrich', 'worm', 'polar bear', 'goldfish', 'swan',
  ],
  food: [
    'pizza', 'hamburger', 'hot dog', 'taco', 'burrito', 'sushi', 'spaghetti', 'pancakes', 'waffle', 'donut',
    'cupcake', 'birthday cake', 'ice cream', 'popcorn', 'cookie', 'croissant', 'bagel', 'pretzel', 'sandwich', 'french fries',
    'apple', 'banana', 'pineapple', 'watermelon', 'strawberry', 'cherry', 'grapes', 'lemon', 'orange', 'pear',
    'avocado', 'carrot', 'broccoli', 'corn', 'mushroom', 'pumpkin', 'potato', 'tomato', 'onion', 'chili pepper',
    'fried egg', 'bacon', 'cheese', 'bread', 'toast', 'cereal', 'soup', 'salad', 'noodles', 'dumpling',
    'lollipop', 'candy cane', 'chocolate bar', 'milkshake', 'coffee', 'teapot', 'lemonade', 'smoothie', 'peanut', 'coconut',
    'honey', 'popsicle', 'nachos', 'pie', 'kebab', 'cotton candy', 'gingerbread man', 'jelly beans',
  ],
  objects: [
    'chair', 'table', 'lamp', 'bed', 'couch', 'clock', 'mirror', 'umbrella', 'key', 'padlock',
    'door', 'window', 'ladder', 'bucket', 'broom', 'toothbrush', 'comb', 'candle', 'fork', 'spoon',
    'plate', 'bottle', 'glasses', 'top hat', 'shoe', 'sock', 'glove', 'backpack', 'suitcase', 'wallet',
    'ring', 'necklace', 'crown', 'balloon', 'kite', 'gift', 'basket', 'pillow', 'blanket', 'bathtub',
    'sink', 'fridge', 'oven', 'toaster', 'fan', 'light bulb', 'battery', 'magnet', 'hammer', 'screwdriver',
    'saw', 'wrench', 'paintbrush', 'envelope', 'bell', 'anchor', 'trophy', 'telescope', 'rocking chair', 'watering can',
    'bicycle', 'skateboard', 'guitar', 'drum', 'piano', 'violin', 'camera', 'scissors',
  ],
  office: [
    'laptop', 'keyboard', 'computer mouse', 'monitor', 'printer', 'stapler', 'paperclip', 'calculator', 'calendar', 'clipboard',
    'desk', 'office chair', 'coffee mug', 'whiteboard', 'sticky note', 'folder', 'briefcase', 'headphones', 'microphone', 'webcam',
    'smartphone', 'tablet', 'charger', 'usb stick', 'router', 'server rack', 'email', 'password', 'wifi', 'spreadsheet',
    'pie chart', 'bar graph', 'presentation', 'meeting', 'name tag', 'elevator', 'water cooler', 'pencil', 'pen', 'eraser',
    'ruler', 'notebook', 'highlighter', 'bug', 'firewall', 'satellite', 'drone', 'smartwatch', 'loading bar', 'trash can',
    'paper shredder', 'desk lamp', 'filing cabinet', 'rubber stamp', 'tape dispenser', 'thumbtack', 'bulletin board', 'video call', 'mute button', 'cursor',
    'hashtag', 'qr code', 'barcode', 'lanyard', 'deadline', 'coffee break', 'org chart', 'inbox',
  ],
  places: [
    'beach', 'castle', 'lighthouse', 'volcano', 'island', 'desert', 'jungle', 'mountain', 'cave', 'waterfall',
    'bridge', 'pyramid', 'igloo', 'farm', 'barn', 'zoo', 'circus', 'library', 'museum', 'school',
    'hospital', 'airport', 'train station', 'bus stop', 'gas station', 'supermarket', 'bakery', 'restaurant', 'cafe', 'cinema',
    'stadium', 'playground', 'park', 'garden', 'swimming pool', 'gym', 'bowling alley', 'space station', 'city', 'skyscraper',
    'tent', 'treehouse', 'windmill', 'haunted house', 'pirate ship', 'submarine', 'hotel', 'office', 'factory', 'bank',
    'post office', 'fire station', 'harbor', 'north pole', 'eiffel tower', 'great wall', 'roller coaster', 'ferris wheel', 'aquarium', 'observatory',
    'parking lot', 'highway', 'tunnel', 'moon base', 'campsite', 'train',
  ],
  actions: [
    'running', 'jumping', 'swimming', 'dancing', 'singing', 'sleeping', 'cooking', 'reading', 'writing', 'painting',
    'fishing', 'surfing', 'skiing', 'snowboarding', 'skateboarding', 'cycling', 'climbing', 'juggling', 'yawning', 'sneezing',
    'laughing', 'crying', 'waving', 'clapping', 'typing', 'texting', 'hugging', 'knitting', 'gardening', 'bowling',
    'golf', 'tennis', 'basketball', 'soccer', 'baseball', 'volleyball', 'hockey', 'boxing', 'karate', 'yoga',
    'archery', 'diving', 'rowing', 'sailing', 'hiking', 'camping', 'bungee jumping', 'skydiving', 'marathon', 'high five',
    'tug of war', 'hide and seek', 'cartwheel', 'push-up', 'weightlifting', 'ping pong', 'badminton', 'fencing', 'gymnastics', 'horse riding',
    'ice skating', 'limbo', 'sledding', 'sprinting', 'brainstorming', 'stretching',
  ],
  arcade: [
    'joystick', 'pinball', 'claw machine', 'maze', 'ghost', 'power-up', 'high score', 'game over', 'extra life', 'coin slot',
    'token', 'controller', 'cartridge', 'dice', 'chess', 'checkers', 'playing card', 'poker chip', 'slot machine', 'dartboard',
    'bowling pin', 'air hockey', 'skee-ball', 'race car', 'spaceship', 'alien', 'laser', 'robot', 'boss battle', 'treasure chest',
    'sword', 'shield', 'potion', 'wizard', 'knight', 'health bar', 'level up', 'checkpoint', 'finish line', 'medal',
    'jigsaw puzzle', 'crossword', 'puzzle cube', 'yo-yo', 'spinning top', 'marbles', 'board game', 'tic-tac-toe', 'dominoes', 'bingo',
    'roulette wheel', 'magic trick', 'teddy bear', 'water gun', 'frisbee', 'hula hoop', 'pogo stick', 'jump rope', 'pixel', 'glitch',
    'arcade cabinet', 'leaderboard', 'treasure map', 'dungeon', 'monster', 'ninja', 'pirate', 'ufo',
  ],
  nature: [
    'tree', 'flower', 'sunflower', 'rose', 'cactus', 'fern', 'leaf', 'rainbow', 'sun', 'cloud',
    'rain', 'snow', 'snowman', 'lightning', 'tornado', 'storm', 'fog', 'wind', 'iceberg', 'glacier',
    'river', 'lake', 'ocean', 'wave', 'sunset', 'moon', 'star', 'comet', 'planet', 'galaxy',
    'meteor', 'earthquake', 'forest', 'palm tree', 'pine cone', 'acorn', 'seed', 'grass', 'bush', 'coral',
    'seaweed', 'pebble', 'sand castle', 'puddle', 'raindrop', 'snowflake', 'icicle', 'thermometer', 'four-leaf clover', 'dandelion',
    'tulip', 'lily pad', 'bamboo', 'branch', 'log', 'bird nest', 'beehive', 'spider web', 'footprint', 'seashell',
    'aurora', 'eclipse', 'hill', 'cliff', 'meadow', 'mushroom ring', 'autumn leaves', 'apple tree',
  ],
};
