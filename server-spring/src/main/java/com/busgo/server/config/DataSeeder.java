package com.busgo.server.config;

import com.busgo.server.entity.Role;
import com.busgo.server.entity.User;
import com.busgo.server.entity.Bus;
import com.busgo.server.entity.Route;
import com.busgo.server.entity.Stop;
import com.busgo.server.entity.RouteStop;
import com.busgo.server.repository.UserRepository;
import com.busgo.server.repository.BusRepository;
import com.busgo.server.repository.RouteRepository;
import com.busgo.server.repository.StopRepository;
import com.busgo.server.repository.RouteStopRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

@Component
@Order(1)
@RequiredArgsConstructor
public class DataSeeder implements CommandLineRunner {

    private final UserRepository userRepository;
    private final BusRepository busRepository;
    private final RouteRepository routeRepository;
    private final StopRepository stopRepository;
    private final RouteStopRepository routeStopRepository;
    private final PasswordEncoder passwordEncoder;

    /**
     * Catalogue of well-known Bengaluru stops: {name, latitude, longitude}.
     * Seeded so routes can be built by picking stops instead of typing
     * coordinates by hand. Coordinates are approximate area centres - accurate
     * enough for the map and for simulation, but check any stop you intend to
     * use for real-GPS geofencing (see busgo.geofence.radius). The Stops tab
     * has a "Use my current location" button for correcting them on site.
     */
    private static final String[][] STOP_CATALOG = {
            // --- Central ---
            {"Kempegowda Bus Station (Majestic)", "12.9774", "77.5726"},
            {"Shivajinagar Bus Station", "12.9853", "77.6055"},
            {"KR Market", "12.9629", "77.5772"},
            {"MG Road", "12.9750", "77.6060"},
            {"Basavanagudi", "12.9420", "77.5730"},
            // --- South ---
            {"Banashankari TTMC", "12.9250", "77.5730"},
            {"Jayanagar 4th Block", "12.9250", "77.5938"},
            {"JP Nagar", "12.9100", "77.5850"},
            {"BTM Layout", "12.9166", "77.6101"},
            {"Silk Board", "12.9172", "77.6229"},
            {"Koramangala", "12.9352", "77.6245"},
            {"HSR Layout", "12.9121", "77.6446"},
            {"Bommanahalli", "12.8996", "77.6187"},
            {"Electronic City", "12.8452", "77.6602"},
            {"Bannerghatta", "12.8000", "77.5770"},
            {"Attibele", "12.7870", "77.7730"},
            // --- East ---
            {"Indiranagar", "12.9784", "77.6408"},
            {"Domlur", "12.9608", "77.6387"},
            {"Bellandur", "12.9260", "77.6762"},
            {"Marathahalli", "12.9591", "77.6974"},
            {"Whitefield (ITPL)", "12.9850", "77.7360"},
            {"Kadugodi", "12.9950", "77.7570"},
            {"Sarjapur", "12.8600", "77.7860"},
            {"KR Puram", "13.0075", "77.6957"},
            {"Banaswadi", "13.0137", "77.6510"},
            {"Kalyan Nagar", "13.0230", "77.6400"},
            {"Hennur", "13.0400", "77.6400"},
            {"Hoskote", "13.0700", "77.7980"},
            // --- West ---
            {"Vijayanagar TTMC", "12.9719", "77.5380"},
            {"Rajajinagar", "12.9910", "77.5520"},
            {"Kengeri TTMC", "12.9060", "77.4820"},
            {"Rajarajeshwari Nagar", "12.9260", "77.5180"},
            {"Nelamangala", "13.0990", "77.3940"},
            // --- North ---
            {"Malleswaram", "13.0035", "77.5712"},
            {"Yeshwanthpur", "13.0234", "77.5540"},
            {"Peenya", "13.0290", "77.5190"},
            {"Jalahalli Cross", "13.0400", "77.5480"},
            {"Nagasandra", "13.0480", "77.5000"},
            {"Vidyaranyapura", "13.0730", "77.5560"},
            {"Sahakara Nagar", "13.0620", "77.5800"},
            {"Jakkur", "13.0770", "77.5980"},
            {"Devanahalli", "13.2470", "77.7120"},
            {"Kempegowda International Airport", "13.1986", "77.7066"},
    };

    /** Ready-made corridors built from the catalogue: {routeName, stop1, stop2, ...}. */
    private static final String[][] CATALOG_ROUTES = {
            {"Majestic - Whitefield",
                    "Kempegowda Bus Station (Majestic)", "MG Road", "Indiranagar", "Domlur",
                    "Marathahalli", "Whitefield (ITPL)", "Kadugodi"},
            {"Majestic - Electronic City",
                    "Kempegowda Bus Station (Majestic)", "KR Market", "Jayanagar 4th Block",
                    "BTM Layout", "Silk Board", "Bommanahalli", "Electronic City"},
            {"Hebbal - Silk Board (Outer Ring Road)",
                    "Hebbal", "KR Puram", "Marathahalli", "Bellandur", "HSR Layout", "Silk Board"},
            {"Majestic - Airport",
                    "Kempegowda Bus Station (Majestic)", "Hebbal", "Yelahanka", "Devanahalli",
                    "Kempegowda International Airport"},
            {"Banashankari - Hebbal",
                    "Banashankari TTMC", "Vijayanagar TTMC", "Rajajinagar", "Yeshwanthpur", "Hebbal"},
    };

    @Override
    public void run(String... args) throws Exception {
        seedAdminUser();
        seedConductorUser();
        seedDummyData();
        seedStopCatalog();
        seedCatalogRoutes();
    }

    /**
     * Adds any catalogue stop that is missing. Existing stops keep whatever
     * coordinates they already have, so corrections made through the admin UI
     * survive a restart.
     */
    private void seedStopCatalog() {
        int created = 0;
        int backfilled = 0;
        for (String[] entry : STOP_CATALOG) {
            String name = entry[0];
            Double lat = Double.valueOf(entry[1]);
            Double lon = Double.valueOf(entry[2]);

            Stop stop = stopRepository.findByName(name).orElse(null);
            if (stop == null) {
                stopRepository.save(Stop.builder().name(name).latitude(lat).longitude(lon).build());
                created++;
            } else if (stop.getLatitude() == null || stop.getLongitude() == null) {
                stop.setLatitude(lat);
                stop.setLongitude(lon);
                stopRepository.save(stop);
                backfilled++;
            }
        }
        if (created > 0 || backfilled > 0) {
            System.out.println("Stop catalogue: " + created + " stop(s) added, "
                    + backfilled + " given coordinates.");
        }
    }

    /** Creates the ready-made routes, skipping any that already exist. */
    private void seedCatalogRoutes() {
        for (String[] spec : CATALOG_ROUTES) {
            String routeName = spec[0];
            if (routeRepository.findByName(routeName).isPresent()) {
                continue;
            }
            Route route = routeRepository.save(Route.builder().name(routeName).build());
            int order = 1;
            for (int i = 1; i < spec.length; i++) {
                Stop stop = stopRepository.findByName(spec[i]).orElse(null);
                if (stop == null) {
                    System.out.println("Route '" + routeName + "': skipping unknown stop '" + spec[i] + "'");
                    continue;
                }
                routeStopRepository.save(RouteStop.builder().route(route).stop(stop).stopOrder(order++).build());
            }
            System.out.println("Added route: " + routeName + " (" + (order - 1) + " stops)");
        }
    }

    private void seedAdminUser() {
        if (userRepository.findByEmail("admin@busgo.ai").isEmpty()) {
            User admin = User.builder()
                    .name("System Admin")
                    .email("admin@busgo.ai")
                    .password(passwordEncoder.encode("admin123"))
                    .role(Role.ADMIN)
                    .build();
            userRepository.save(admin);
            System.out.println("Default Admin user created: admin@busgo.ai / admin123");
        }
    }

    private void seedConductorUser() {
        if (userRepository.findByEmail("conductor@busgo.ai").isEmpty()) {
            User conductor = User.builder()
                    .name("Ramesh (Conductor)")
                    .email("conductor@busgo.ai")
                    .password(passwordEncoder.encode("conductor123"))
                    .role(Role.CONDUCTOR)
                    .build();
            userRepository.save(conductor);
            System.out.println("Default Conductor user created: conductor@busgo.ai / conductor123");
        }
        
        // Ensure syed@busgo.ai exists as requested by user's test scenario
        if (userRepository.findByEmail("syed@busgo.ai").isEmpty()) {
            User conductor2 = User.builder()
                    .name("Syed (Conductor)")
                    .email("syed@busgo.ai")
                    .password(passwordEncoder.encode("password"))
                    .role(Role.CONDUCTOR)
                    .build();
            userRepository.save(conductor2);
            System.out.println("Default Conductor user created: syed@busgo.ai / password");
        }
    }

    private void seedDummyData() {
        System.out.println("Seeding routes and stops...");
        
        Stop s1 = stopRepository.findByName("Hebbal").orElseGet(() -> Stop.builder().name("Hebbal").build());
        s1.setLatitude(13.0358);
        s1.setLongitude(77.5970);
        s1 = stopRepository.save(s1);
        
        Stop s2 = stopRepository.findByName("Yelahanka").orElseGet(() -> Stop.builder().name("Yelahanka").build());
        s2.setLatitude(13.1007);
        s2.setLongitude(77.5963);
        s2 = stopRepository.save(s2);
        
        Stop s3 = stopRepository.findByName("Doddaballapura").orElseGet(() -> Stop.builder().name("Doddaballapura").build());
        s3.setLatitude(13.2924);
        s3.setLongitude(77.5430);
        s3 = stopRepository.save(s3);

        if (routeRepository.findByName("Hebbal - Doddaballapura").isEmpty()) {
            Route r1 = routeRepository.save(Route.builder().name("Hebbal - Doddaballapura").build());
            routeStopRepository.save(RouteStop.builder().route(r1).stop(s1).stopOrder(1).build());
            routeStopRepository.save(RouteStop.builder().route(r1).stop(s2).stopOrder(2).build());
            routeStopRepository.save(RouteStop.builder().route(r1).stop(s3).stopOrder(3).build());
            System.out.println("Added Hebbal - Doddaballapura route.");
        }

        if (busRepository.count() == 0) {
            System.out.println("Seeding dummy buses...");
            Bus bus1 = Bus.builder()
                .busNumber("KA-01-F-1234")
                .capacity(50)
                .build();
            Bus bus2 = Bus.builder()
                .busNumber("MH-12-AB-9876")
                .capacity(45)
                .build();
            busRepository.save(bus1);
            busRepository.save(bus2);
        }
    }
}
