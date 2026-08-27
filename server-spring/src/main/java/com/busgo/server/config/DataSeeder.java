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
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class DataSeeder implements CommandLineRunner {

    private final UserRepository userRepository;
    private final BusRepository busRepository;
    private final RouteRepository routeRepository;
    private final StopRepository stopRepository;
    private final RouteStopRepository routeStopRepository;
    private final PasswordEncoder passwordEncoder;

    @Override
    public void run(String... args) throws Exception {
        seedAdminUser();
        seedConductorUser();
        seedDummyData();
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
